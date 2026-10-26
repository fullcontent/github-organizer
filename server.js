require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const { AsyncLocalStorage } = require('async_hooks');

const app = express();
const requestContext = new AsyncLocalStorage();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware para capturar credenciais dinâmicas do cliente (headers ou query)
app.use((req, res, next) => {
    const clientToken = (req.headers['x-github-token'] || req.query.gh_token || '').toString().trim();
    const clientRepo = (req.headers['x-github-repo'] || req.query.gh_repo || '').toString().trim();
    requestContext.run({ token: clientToken, repo: clientRepo }, next);
});

// Diretório local para persistência de dados e cache (suporte seguro ao Vercel Serverless /tmp)
const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
} catch (e) {
    console.warn('Aviso ao inicializar DATA_DIR:', e.message);
}
const DASHBOARD_CACHE_FILE = path.join(DATA_DIR, 'dashboard_cache.json');
const SUMMARIES_CACHE_FILE = path.join(DATA_DIR, 'issue_summaries.json');
const AI_CONFIG_FILE = path.join(DATA_DIR, 'ai_config.json');
const SUGGESTED_TITLES_FILE = path.join(DATA_DIR, 'suggested_titles.json');
const MILESTONES_ORDER_FILE = path.join(DATA_DIR, 'milestones_order.json');
const LABEL_TRANSLATIONS_FILE = path.join(DATA_DIR, 'label_translations.json');

const DEFAULT_EXPLAIN_PROMPT = `Você é um analista técnico sênior e desenvolvedor. Analise a seguinte issue do GitHub e forneça EXATAMENTE UM PARÁGRAFO conciso, claro e objetivo (em português brasileiro), explicando:
1. Do que se trata esta issue (contexto da demanda);
2. Qual o problema a ser resolvido ou a funcionalidade proposta;
3. Qual o resultado ou impacto esperado para os usuários ou sistema.

Issue #{number}: {title}
Tipo/Labels: {labels}
Descrição da Issue:
{body}

Responda APENAS com um parágrafo de 3 a 5 frases, sem saudações e sem introduções.`;

const DEFAULT_HOURS_PROMPT = `Você é um especialista em métricas de engenharia de software e estimativa de esforço de equipes. Avalie as atividades de desenvolvimento do repositório no último mês e faça uma estimativa das HORAS DE TRABALHO totais da equipe:
- Total de issues no mês: {issuesCount} (Features/Melhorias: {featuresCount}, Bugs/Correções: {bugsCount})
- Exemplos de demandas e escopo:
{sampleIssues}
- Volume de commits: {commitsCount} commits
- Volume estimado de arquivos alterados: ~{totalFilesChanged} arquivos (+{totalAdditions} / -{totalDeletions} linhas de código)

Avalie a complexidade do texto nas issues e o volume de arquivos/código entregue nos commits e faça a média de horas de trabalho no mês.
Responda APENAS em formato JSON estrito:
{
  "estimatedHours": <numero_inteiro>,
  "issuesComponentHours": <numero_inteiro>,
  "commitsComponentHours": <numero_inteiro>,
  "analysis": "<paragrafo conciso explicando a média calculada>"
}`;

function loadJsonFile(file, fallback = {}) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf-8'));
        }
    } catch (e) {
        console.error('Erro ao ler arquivo JSON:', file, e.message);
    }
    return fallback;
}

function saveJsonFile(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('Erro ao salvar arquivo JSON:', file, e.message);
    }
}

// -------------------------------------------------------------
// CONFIGURAÇÃO DINÂMICA DE IA
// -------------------------------------------------------------
function getAIConfig() {
    let saved = loadJsonFile(AI_CONFIG_FILE, null);
    if (!saved) {
        saved = {
            enabled: true,
            provider: process.env.GEMINI_API_KEY ? 'gemini' : (process.env.OPENAI_API_KEY ? 'opencode' : 'ollama'),
            ollama: {
                url: process.env.OLLAMA_URL || 'http://localhost:11434',
                model: process.env.OLLAMA_MODEL || 'llama3.2',
                authType: (process.env.OLLAMA_USER && process.env.OLLAMA_PASSWORD) ? 'basic' : (process.env.OLLAMA_API_KEY ? 'bearer' : 'none'),
                user: process.env.OLLAMA_USER || '',
                password: process.env.OLLAMA_PASSWORD || '',
                apiKey: process.env.OLLAMA_API_KEY || ''
            },
            gemini: {
                apiKey: process.env.GEMINI_API_KEY || '',
                model: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
            },
            opencode: {
                apiKey: process.env.OPENAI_API_KEY || '',
                baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
            },
            prompts: {
                explainIssue: DEFAULT_EXPLAIN_PROMPT,
                estimateHours: DEFAULT_HOURS_PROMPT
            }
        };
        saveJsonFile(AI_CONFIG_FILE, saved);
    } else {
        if (!saved.prompts) {
            saved.prompts = {
                explainIssue: DEFAULT_EXPLAIN_PROMPT,
                estimateHours: DEFAULT_HOURS_PROMPT
            };
            saveJsonFile(AI_CONFIG_FILE, saved);
        }
    }
    return saved;
}

function saveAIConfig(newConfig) {
    saveJsonFile(AI_CONFIG_FILE, newConfig);
    return newConfig;
}

const GITHUB_CONFIG_FILE = path.join(DATA_DIR, 'github_config.json');

// Obtém o repositório do GitHub (ordem: header do cliente, arquivo local salvo, env var, ou fallback padrão)
function getRepo(req = null) {
    const store = requestContext.getStore();
    if (store && store.repo) return store.repo;
    if (req && req.headers && req.headers['x-github-repo']) return req.headers['x-github-repo'].trim();
    const localGithub = loadJsonFile(GITHUB_CONFIG_FILE, {});
    if (localGithub && localGithub.repository && localGithub.repository.trim()) {
        return localGithub.repository.trim();
    }
    if (process.env.GITHUB_REPO && process.env.GITHUB_REPO.trim()) {
        return process.env.GITHUB_REPO.trim();
    }
    return 'fullcontent/sistemacelic';
}

// Obtém o token do GitHub disponível (ordem: header do cliente, arquivo local seguro, variáveis de ambiente, ou GitHub CLI)
function getGitHubToken(req = null) {
    const store = requestContext.getStore();
    if (store && store.token) return store.token;
    if (req && req.headers && req.headers['x-github-token']) return req.headers['x-github-token'].trim();
    const localGithub = loadJsonFile(GITHUB_CONFIG_FILE, {});
    if (localGithub && localGithub.token && localGithub.token.trim()) {
        return localGithub.token.trim();
    }
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) {
        return process.env.GITHUB_TOKEN.trim();
    }
    if (process.env.GITHUB_TOKEN_CLASSIC && process.env.GITHUB_TOKEN_CLASSIC.trim()) {
        return process.env.GITHUB_TOKEN_CLASSIC.trim();
    }
    if (process.env.GITHUB_TOKEN_FINE && process.env.GITHUB_TOKEN_FINE.trim()) {
        return process.env.GITHUB_TOKEN_FINE.trim();
    }
    try {
        const token = execSync('gh auth token', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).trim();
        if (token) return token;
    } catch (e) {
        // gh CLI não disponível ou não autenticado
    }
    return '';
}

function maskToken(token) {
    if (!token || token.length < 8) return '';
    const prefix = token.slice(0, 4);
    const suffix = token.slice(-4);
    return `${prefix}••••••••••••••••${suffix}`;
}

function getHeaders(req = null) {
    const token = getGitHubToken(req);
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'github-organizer'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

const api = axios.create();

api.interceptors.request.use(config => {
    const currentRepo = getRepo();
    config.baseURL = `https://api.github.com/repos/${currentRepo}`;
    const token = getGitHubToken();
    config.headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'github-organizer',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...config.headers
    };
    return config;
});

// Cache em memória por repositório
let issuesCacheByRepo = new Map();
let issuesCache = {
    get data() {
        const item = issuesCacheByRepo.get(getRepo());
        return item ? item.data : null;
    },
    set data(val) {
        const repo = getRepo();
        const existing = issuesCacheByRepo.get(repo) || {};
        issuesCacheByRepo.set(repo, { ...existing, data: val });
    },
    get timestamp() {
        const item = issuesCacheByRepo.get(getRepo());
        return item ? item.timestamp : 0;
    },
    set timestamp(val) {
        const repo = getRepo();
        const existing = issuesCacheByRepo.get(repo) || {};
        issuesCacheByRepo.set(repo, { ...existing, timestamp: val });
    }
};

let commitsCache = {
    data: new Map(),
};

async function getAllIssues(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && issuesCache.data && (now - issuesCache.timestamp < 5 * 60 * 1000)) {
        return issuesCache.data;
    }

    let allIssues = [];
    let page = 1;
    while (true) {
        const response = await api.get(`/issues?state=all&per_page=100&page=${page}`);
        if (!response.data || response.data.length === 0) break;
        
        // GitHub API retorna Pull Requests dentro de issues, filtramos fora
        const issuesOnly = response.data.filter(item => !item.pull_request);
        allIssues.push(...issuesOnly);
        
        if (response.data.length < 100) break;
        page++;
    }

    issuesCache.data = allIssues;
    issuesCache.timestamp = now;
    return allIssues;
}

async function getCommitsForRange(startDate, endDate, forceRefresh = false) {
    const cacheKey = `${startDate.toISOString().slice(0, 10)}_${endDate.toISOString().slice(0, 10)}`;
    const now = Date.now();
    const cached = commitsCache.data.get(cacheKey);

    if (!forceRefresh && cached && (now - cached.timestamp < 5 * 60 * 1000)) {
        return cached.commits;
    }

    let commits = [];
    let page = 1;
    const since = startDate.toISOString();
    const until = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), 23, 59, 59, 999)).toISOString();

    try {
        while (page <= 5) {
            const response = await api.get(`/commits?since=${since}&until=${until}&per_page=100&page=${page}`);
            if (!response.data || response.data.length === 0) break;
            commits.push(...response.data);
            if (response.data.length < 100) break;
            page++;
        }
    } catch (err) {
        console.error('Erro ao buscar commits para período:', err.response?.data || err.message);
    }

    commitsCache.data.set(cacheKey, { commits, timestamp: now });
    return commits;
}

// -------------------------------------------------------------
// SERVIÇO DE IA (OLLAMA / GEMINI / OPENCODE / HEURÍSTICA)
// -------------------------------------------------------------
async function callAI(prompt, systemInstruction = '', overrideConfig = null) {
    const config = overrideConfig || getAIConfig();
    
    // Se a IA estiver desativada pelo usuário
    if (config.enabled === false) {
        return {
            text: '',
            provider: 'disabled',
            providerInfo: 'IA Desativada nas Configurações'
        };
    }

    // 1. Ollama (Local ou Privado - Ex: http://localhost:11434 ou um proxy/Tailscale próprio)
    if (config.provider === 'ollama') {
        const ollama = config.ollama || {};
        const url = (ollama.url || process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
        const model = ollama.model || process.env.OLLAMA_MODEL || 'gemma3:12b';
        const clientName = ollama.clientName || process.env.OLLAMA_CLIENT_NAME || 'github-organizer';
        
        let reqConfig = { 
            timeout: process.env.VERCEL ? 8500 : 30000, 
            headers: {
                'X-Client-Name': clientName
            } 
        };
        const user = ollama.user || process.env.OLLAMA_USER;
        const pass = ollama.password || process.env.OLLAMA_PASSWORD;
        const apiKey = ollama.apiKey || process.env.OLLAMA_API_KEY;

        if (user && pass) {
            reqConfig.auth = { username: user, password: pass };
        }
        if (apiKey) {
            reqConfig.headers['Authorization'] = `Bearer ${apiKey}`;
            reqConfig.headers['X-Ollama-Token'] = apiKey;
        }

        try {
            const response = await axios.post(`${url}/api/generate`, {
                model: model,
                prompt: (systemInstruction ? systemInstruction + '\n\n' : '') + prompt,
                stream: false
            }, reqConfig);

            if (response.data && response.data.response) {
                return {
                    text: response.data.response.trim(),
                    provider: 'ollama',
                    providerInfo: `Ollama (${url} - ${model})`
                };
            }
        } catch (err) {
            console.warn('[IA] Erro na chamada Ollama:', err.message, err.response?.status);
            return {
                text: '',
                provider: 'heuristic',
                providerInfo: 'Motor Analítico Integrado (Heurístico)',
                authNote: `Ollama (${url}) erro: ${err.response?.status === 401 ? '401 Não Autorizado. Verifique o X-Ollama-Token ou credenciais nas Configurações.' : err.message}`
            };
        }
    }

    // 2. Google Gemini
    if (config.provider === 'gemini') {
        const gemini = config.gemini || {};
        const key = gemini.apiKey || process.env.GEMINI_API_KEY;
        const model = gemini.model || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
        
        if (key) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
                const response = await axios.post(url, {
                    contents: [{
                        parts: [{ text: (systemInstruction ? systemInstruction + '\n\n' : '') + prompt }]
                    }]
                }, { timeout: process.env.VERCEL ? 8500 : 15000 });

                const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                    return {
                        text: text.trim(),
                        provider: 'gemini',
                        providerInfo: `Google Gemini (${model})`
                    };
                }
            } catch (err) {
                console.warn('[IA] Erro na API do Gemini:', err.message);
                return {
                    text: '',
                    provider: 'heuristic',
                    providerInfo: 'Motor Analítico Integrado (Heurístico)',
                    authNote: `Gemini erro: ${err.response?.data?.error?.message || err.message}`
                };
            }
        }
    }

    // 3. OpenAI / OpenCode
    if (config.provider === 'opencode') {
        const opencode = config.opencode || {};
        const key = opencode.apiKey || process.env.OPENAI_API_KEY;
        const baseUrl = (opencode.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const model = opencode.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

        if (key) {
            try {
                const response = await axios.post(`${baseUrl}/chat/completions`, {
                    model: model,
                    messages: [
                        ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
                        { role: 'user', content: prompt }
                    ]
                }, {
                    headers: { 'Authorization': `Bearer ${key}` },
                    timeout: 15000
                });

                const text = response.data?.choices?.[0]?.message?.content;
                if (text) {
                    return {
                        text: text.trim(),
                        provider: 'opencode',
                        providerInfo: `OpenCode/OpenAI (${model})`
                    };
                }
            } catch (err) {
                console.warn('[IA] Erro na API do OpenCode/OpenAI:', err.message);
                return {
                    text: '',
                    provider: 'heuristic',
                    providerInfo: 'Motor Analítico Integrado (Heurístico)',
                    authNote: `OpenCode erro: ${err.response?.data?.error?.message || err.message}`
                };
            }
        }
    }

    // 4. Fallback Heurístico
    return {
        text: '',
        provider: 'heuristic',
        providerInfo: 'Motor Analítico Integrado (Heurístico)',
        authNote: 'Configure e teste suas credenciais no botão "Configuração IA" no topo da página.'
    };
}

// Explica uma issue em 1 parágrafo (com opção de regerar via force=true)
async function explainIssue(issueNumber, force = false) {
    const summaries = loadJsonFile(SUMMARIES_CACHE_FILE, {});
    if (!force && summaries[issueNumber] && summaries[issueNumber].provider !== 'heuristic') {
        const cached = summaries[issueNumber];
        if (!cached.body) {
            try {
                const { data: issue } = await api.get(`/issues/${issueNumber}`);
                cached.body = issue.body || '';
                saveJsonFile(SUMMARIES_CACHE_FILE, summaries);
            } catch (e) {}
        }
        return {
            ...cached,
            issue: {
                number: cached.number,
                title: cached.title,
                body: cached.body || '',
                html_url: cached.html_url
            }
        };
    }

    const { data: issue } = await api.get(`/issues/${issueNumber}`);
    const labels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name).join(', ');
    const bodyClean = (issue.body || '').replace(/\r\n/g, '\n').substring(0, 3000);

    const aiConfig = getAIConfig();
    let promptTemplate = aiConfig.prompts?.explainIssue || DEFAULT_EXPLAIN_PROMPT;
    let prompt = promptTemplate
        .replace(/\{number\}/g, String(issue.number))
        .replace(/\{title\}/g, issue.title || '')
        .replace(/\{labels\}/g, labels || 'Nenhuma')
        .replace(/\{body\}/g, bodyClean || 'Sem descrição detalhada fornecida.');

    const aiRes = await callAI(prompt);
    let summaryText = aiRes.text;

    if (!summaryText || aiRes.provider === 'heuristic' || aiRes.provider === 'disabled') {
        const firstLines = bodyClean
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#') && !l.startsWith('!['))
            .slice(0, 3)
            .join(' ');

        summaryText = `A issue #${issue.number} ("${issue.title}") refere-se a ${labels ? `uma demanda categorizada como [${labels}]` : 'uma melhoria no sistema'}. ${firstLines ? `O escopo principal visa: ${firstLines.substring(0, 260)}...` : 'Trata-se de uma implementação essencial para o fluxo da plataforma.'}`;
        
        if (aiRes.authNote) {
            summaryText += `\n\n💡 Nota: ${aiRes.authNote}`;
        }
    }

    const result = {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        html_url: issue.html_url,
        labels: (issue.labels || []).map(l => typeof l === 'string' ? { name: l, color: 'e2e8f0' } : { name: l.name, color: l.color || 'e2e8f0' }),
        milestone: issue.milestone ? { id: issue.milestone.id, number: issue.milestone.number, title: issue.milestone.title } : null,
        user: { login: issue.user?.login || 'Autor', avatar_url: issue.user?.avatar_url || '' },
        body: issue.body || '',
        issue: {
            number: issue.number,
            title: issue.title,
            body: issue.body || '',
            html_url: issue.html_url
        },
        summary: summaryText.trim(),
        provider: aiRes.provider,
        providerInfo: aiRes.providerInfo,
        updatedAt: new Date().toISOString()
    };

    summaries[issueNumber] = result;
    saveJsonFile(SUMMARIES_CACHE_FILE, summaries);
    return result;
}

// Limpeza heurística de título
function heuristicCleanTitle(originalTitle) {
    let title = (originalTitle || '').trim();
    title = title.replace(/^\[(feature|bug|refactor|fix|docs|chore)\/[^\]]+\]\s*/i, '');
    title = title.replace(/^\[[^\]]+\]\s*/i, '');
    title = title.replace(/^(feat|fix|docs|chore|refactor)(\([^)]+\))?:\s*/i, '');
    title = title.trim();
    if (!title) return originalTitle;
    return title.charAt(0).toUpperCase() + title.slice(1);
}

// Gera título sugerido por IA
async function generateSuggestedTitle(issue) {
    const aiConfig = getAIConfig();
    if (!aiConfig.enabled) {
        return heuristicCleanTitle(issue.title);
    }

    const labels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name).join(', ');
    const bodySnippet = (issue.body || '').substring(0, 400);

    const prompt = `Você é um analista técnico especialista em clareza de backlog de software.
Crie um TÍTULO CURTO, PADRONIZADO E CONCISO (em português, máximo de 50 a 65 caracteres) para a issue abaixo.
Original: "${issue.title}"
Labels: ${labels}
Trecho do Conteúdo: "${bodySnippet}"

Regras:
- Comece com o nome do módulo ou ação direta (ex: "[Notificações] Envio automático de licenças").
- Remova redundâncias, códigos ou prefixos desnecessários.
- Responda APENAS com o novo título sugerido, sem aspas, sem introdução e sem explicações.`;

    const aiRes = await callAI(prompt, 'Responda apenas com o título limpo e padronizado.');
    if (aiRes.text && aiRes.text.length > 5 && aiRes.text.length < 120 && !aiRes.text.includes('\n')) {
        return aiRes.text.replace(/^["']|["']$/g, '').trim();
    }
    return heuristicCleanTitle(issue.title);
}

// Sincroniza e salva localmente os títulos sugeridos (suporta limite por chamada para evitar timeout)
async function syncAllSuggestedTitles(maxBatch = 5) {
    const titlesCache = loadJsonFile(SUGGESTED_TITLES_FILE, {});
    const allIssues = await getAllIssues();
    const aiConfig = getAIConfig();

    let aiWorking = false;
    if (aiConfig.enabled) {
        try {
            const test = await callAI('OK');
            if (test.text && test.provider !== 'heuristic' && test.provider !== 'disabled') {
                aiWorking = true;
            }
        } catch (e) {}
    }

    let processedCount = 0;
    // Para as issues abertas (foco operacional)
    for (const issue of allIssues) {
        if (issue.state !== 'open') continue;
        const id = String(issue.number);
        if (!titlesCache[id] || titlesCache[id].originalTitle !== issue.title || !titlesCache[id].suggestedTitle) {
            let suggested;
            if (aiWorking) {
                try {
                    suggested = await generateSuggestedTitle(issue);
                } catch (e) {
                    suggested = heuristicCleanTitle(issue.title);
                }
            } else {
                suggested = heuristicCleanTitle(issue.title);
            }

            titlesCache[id] = {
                number: issue.number,
                originalTitle: issue.title,
                suggestedTitle: suggested,
                status: 'suggested',
                updatedAt: new Date().toISOString()
            };

            processedCount++;
            if (maxBatch && processedCount >= maxBatch) {
                break;
            }
        }
    }

    saveJsonFile(SUGGESTED_TITLES_FILE, titlesCache);
    return titlesCache;
}

// Estima horas de trabalho do mês avaliando issues e volume de commits
async function calculateEstimatedMonthlyHours(monthIssues, monthCommits) {
    const issuesCount = monthIssues.length;
    const commitsCount = monthCommits.length;

    let totalFilesChanged = 0;
    let totalAdditions = 0;
    let totalDeletions = 0;
    const sampleCommits = monthCommits.slice(0, 10);
    
    try {
        const commitDetails = await Promise.all(
            sampleCommits.map(c => api.get(`/commits/${c.sha}`).catch(() => null))
        );
        commitDetails.forEach(res => {
            if (res && res.data) {
                totalFilesChanged += res.data.files?.length || 1;
                totalAdditions += res.data.stats?.additions || 0;
                totalDeletions += res.data.stats?.deletions || 0;
            }
        });
    } catch (e) {}

    if (sampleCommits.length > 0 && monthCommits.length > sampleCommits.length) {
        const factor = monthCommits.length / sampleCommits.length;
        totalFilesChanged = Math.round(totalFilesChanged * factor);
        totalAdditions = Math.round(totalAdditions * factor);
        totalDeletions = Math.round(totalDeletions * factor);
    }

    const bugsCount = monthIssues.filter(i => (i.labels || []).some(l => (typeof l === 'string' ? l : l.name).toLowerCase().includes('bug'))).length;
    const featuresCount = issuesCount - bugsCount;

    const aiConfig = getAIConfig();
    let promptTemplate = aiConfig.prompts?.estimateHours || DEFAULT_HOURS_PROMPT;
    const sampleIssuesText = monthIssues.slice(0, 6).map(i => `  * #${i.number}: ${i.title}`).join('\n');
    const prompt = promptTemplate
        .replace(/\{issuesCount\}/g, String(issuesCount))
        .replace(/\{featuresCount\}/g, String(featuresCount))
        .replace(/\{bugsCount\}/g, String(bugsCount))
        .replace(/\{sampleIssues\}/g, sampleIssuesText)
        .replace(/\{commitsCount\}/g, String(commitsCount))
        .replace(/\{totalFilesChanged\}/g, String(totalFilesChanged || commitsCount))
        .replace(/\{totalAdditions\}/g, String(totalAdditions))
        .replace(/\{totalDeletions\}/g, String(totalDeletions));

    const aiRes = await callAI(prompt, 'Você é um assistente de métricas de software. Responda apenas em JSON.');
    let parsed = null;

    if (aiRes.text) {
        try {
            const match = aiRes.text.match(/\{[\s\S]*\}/);
            if (match) {
                parsed = JSON.parse(match[0]);
            }
        } catch (e) {}
    }

    if (!parsed || !parsed.estimatedHours) {
        let issuesHours = 0;
        monthIssues.forEach(i => {
            const labelsStr = (i.labels || []).map(l => typeof l === 'string' ? l : l.name).join(' ').toLowerCase();
            const isBug = labelsStr.includes('bug');
            const isP0 = labelsStr.includes('p0');
            const isP1 = labelsStr.includes('p1');
            let h = isBug ? 4 : 10;
            if (isP0) h *= 1.5;
            else if (isP1) h *= 1.25;
            if ((i.body || '').length > 2000) h *= 1.2;
            issuesHours += h;
        });

        const commitBase = commitsCount * 2.2;
        const filesBase = (totalFilesChanged || commitsCount) * 1.5;
        const changesBase = Math.min(totalAdditions + totalDeletions, 8000) * 0.015;
        const commitsHours = Math.round(commitBase + filesBase + changesBase);

        const blendedHours = Math.max(1, Math.round((issuesHours + commitsHours) / 2));

        parsed = {
            estimatedHours: blendedHours,
            issuesComponentHours: Math.round(issuesHours),
            commitsComponentHours: commitsHours,
            analysis: `Estimativa obtida pela média ponderada entre o escopo descrito nas ${issuesCount} issues do mês (~${Math.round(issuesHours)}h) e o volume de ${commitsCount} commits com ~${totalFilesChanged || commitsCount} arquivos alterados (~${commitsHours}h).`
        };
    }

    return {
        ...parsed,
        provider: aiRes.provider,
        providerInfo: aiRes.providerInfo,
        stats: {
            issuesCount,
            commitsCount,
            totalFilesChanged: totalFilesChanged || commitsCount,
            totalAdditions,
            totalDeletions
        }
    };
}

// -------------------------------------------------------------
// ROTAS DA API
// -------------------------------------------------------------

// Busca todas as issues abertas (com títulos sugeridos pela IA se disponíveis)
app.get('/api/issues', async (req, res) => {
    try {
        const response = await api.get('/issues?state=open&per_page=100');
        const titlesCache = loadJsonFile(SUGGESTED_TITLES_FILE, {});
        const aiConfig = getAIConfig();

        const enriched = response.data.map(issue => {
            const cached = titlesCache[String(issue.number)];
            return {
                ...issue,
                suggestedTitle: cached ? cached.suggestedTitle : null,
                aiEnabled: aiConfig.enabled !== false
            };
        });

        res.json(enriched);
    } catch (error) {
        console.error('Erro ao buscar issues:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao buscar issues do GitHub' });
    }
});

// Endpoint com IA para explicar uma issue específica em 1 parágrafo (suporta ?force=true para regerar)
app.get('/api/issues/:number/explain', async (req, res) => {
    try {
        const issueNumber = req.params.number;
        const force = req.query.force === 'true' || req.query.refresh === 'true';
        const explanation = await explainIssue(issueNumber, force);
        res.json(explanation);
    } catch (error) {
        console.error('Erro ao gerar explicação da issue:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao gerar explicação da issue', details: error.message });
    }
});

// Atualiza a prioridade de uma issue
app.patch('/api/issues/:number/priority', async (req, res) => {
    const issueNumber = req.params.number;
    const { newPriority } = req.body; 

    try {
        const { data: issue } = await api.get(`/issues/${issueNumber}`);
        const currentLabels = issue.labels.map(l => typeof l === 'string' ? l : l.name);

        let updatedLabels = currentLabels.filter(label => !label.startsWith('priority:'));

        if (newPriority && newPriority !== 'none') {
            updatedLabels.push(newPriority);
        }

        const response = await api.patch(`/issues/${issueNumber}`, {
            labels: updatedLabels
        });

        issuesCache.timestamp = 0;
        res.json(response.data);
    } catch (error) {
        console.error('Erro ao atualizar a issue:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao atualizar a issue no GitHub' });
    }
});

// Alteração de título no GitHub DESATIVADA conforme regra de negócio (o título nunca deve ser alterado no GitHub)
app.patch('/api/issues/:number/title', async (req, res) => {
    return res.status(403).json({ 
        error: 'A alteração de títulos de issues no GitHub foi desativada por segurança. Os títulos originais do repositório são preservados permanentemente.' 
    });
});

// Banco de tradução e significados das labels
app.get('/api/labels/translations', (req, res) => {
    const translations = loadJsonFile(LABEL_TRANSLATIONS_FILE, {});
    res.json(translations);
});

app.post('/api/labels/translations', (req, res) => {
    try {
        const current = loadJsonFile(LABEL_TRANSLATIONS_FILE, {});
        const updated = { ...current, ...(req.body || {}) };
        saveJsonFile(LABEL_TRANSLATIONS_FILE, updated);
        res.json({ success: true, count: Object.keys(updated).length, translations: updated });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao salvar traduções de labels: ' + e.message });
    }
});

// Busca milestones (com ordenação personalizada e campos completos de progresso e datas)
app.get('/api/milestones', async (req, res) => {
    try {
        const state = req.query.state || 'all';
        const response = await api.get(`/milestones?state=${state}&per_page=100`);
        let milestones = response.data;

        const savedOrder = loadJsonFile(MILESTONES_ORDER_FILE, []);
        if (Array.isArray(savedOrder) && savedOrder.length > 0) {
            const orderMap = new Map();
            savedOrder.forEach((num, idx) => orderMap.set(String(num), idx));
            milestones.sort((a, b) => {
                const idxA = orderMap.has(String(a.number)) ? orderMap.get(String(a.number)) : 999;
                const idxB = orderMap.has(String(b.number)) ? orderMap.get(String(b.number)) : 999;
                if (idxA !== idxB) return idxA - idxB;
                return a.title.localeCompare(b.title);
            });
        }

        res.json(milestones);
    } catch (error) {
        console.error('Erro ao buscar milestones:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao buscar milestones do GitHub' });
    }
});

// Cria nova milestone no GitHub
app.post('/api/milestones', async (req, res) => {
    try {
        const { title, description, due_on, state } = req.body;
        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Título da milestone é obrigatório.' });
        }

        const payload = {
            title: title.trim(),
            description: description ? description.trim() : '',
            state: state || 'open'
        };
        if (due_on) {
            payload.due_on = new Date(due_on).toISOString();
        }

        const response = await api.post('/milestones', payload);
        res.status(201).json(response.data);
    } catch (error) {
        console.error('Erro ao criar milestone no GitHub:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao criar milestone no GitHub', details: error.response?.data?.message || error.message });
    }
});

// Atualiza milestone existente no GitHub (título, descrição, due_on, state)
app.patch('/api/milestones/:number', async (req, res) => {
    try {
        const { title, description, due_on, state } = req.body;
        const payload = {};
        if (title !== undefined) payload.title = title.trim();
        if (description !== undefined) payload.description = description.trim();
        if (state !== undefined) payload.state = state;
        if (due_on !== undefined) {
            payload.due_on = due_on ? new Date(due_on).toISOString() : null;
        }

        const response = await api.patch(`/milestones/${req.params.number}`, payload);
        res.json(response.data);
    } catch (error) {
        console.error('Erro ao atualizar milestone no GitHub:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao atualizar milestone no GitHub', details: error.response?.data?.message || error.message });
    }
});

// Consulta a ordem salva das colunas de milestones
app.get('/api/milestones/order', (req, res) => {
    const order = loadJsonFile(MILESTONES_ORDER_FILE, []);
    res.json(order);
});

// Salva a ordem das colunas do quadro de milestones
app.post('/api/milestones/order', (req, res) => {
    const order = req.body.order || [];
    saveJsonFile(MILESTONES_ORDER_FILE, order);
    res.json({ success: true, order });
});

// Atualiza o milestone de uma issue
app.patch('/api/issues/:number/milestone', async (req, res) => {
    const issueNumber = req.params.number;
    const { milestone } = req.body;

    try {
        const response = await api.patch(`/issues/${issueNumber}`, {
            milestone: milestone ? parseInt(milestone) : null
        });

        issuesCache.timestamp = 0;
        res.json(response.data);
    } catch (error) {
        console.error('Erro ao atualizar milestone da issue:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao atualizar a issue no GitHub' });
    }
});

// -------------------------------------------------------------
// ROTAS DE CONFIGURAÇÃO DO GITHUB (TOKEN SEGURO)
// -------------------------------------------------------------
app.get('/api/github/config', (req, res) => {
    const currentToken = getGitHubToken(req);
    const currentRepo = getRepo(req);
    let source = 'none';
    const store = requestContext.getStore();

    if (store && store.token) {
        source = 'client_header';
    } else {
        const localGithub = loadJsonFile(GITHUB_CONFIG_FILE, {});
        if (localGithub && localGithub.token && localGithub.token.trim()) {
            source = 'dashboard_config';
        } else if (process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN_CLASSIC || process.env.GITHUB_TOKEN_FINE) {
            source = 'env_variable';
        } else if (currentToken) {
            source = 'gh_cli';
        }
    }

    res.json({
        configured: Boolean(currentToken),
        maskedToken: maskToken(currentToken),
        source: source,
        repository: currentRepo
    });
});

app.post('/api/github/config', async (req, res) => {
    try {
        const { token, repository } = req.body;
        let localGithub = loadJsonFile(GITHUB_CONFIG_FILE, {});

        let currentToken = (token !== undefined && token !== null && token.trim() !== '') 
            ? token.trim() 
            : (localGithub.token || getGitHubToken(req));

        let currentRepo = (repository !== undefined && repository !== null && repository.trim() !== '') 
            ? repository.trim() 
            : (localGithub.repository || getRepo(req));

        // Se pediu para limpar tudo explicitamente
        if (token === '' && repository === '') {
            saveJsonFile(GITHUB_CONFIG_FILE, {});
            issuesCacheByRepo.clear();
            const fallbackToken = getGitHubToken(req);
            const fallbackRepo = getRepo(req);
            return res.json({ 
                success: true, 
                message: 'Configurações manuais removidas. Utilizando fallback do ambiente/CLI.',
                configured: Boolean(fallbackToken),
                maskedToken: maskToken(fallbackToken),
                repository: fallbackRepo
            });
        }

        let userLogin = '';
        if (currentToken) {
            const testRes = await axios.get('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${currentToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'github-organizer'
                },
                timeout: 10000
            });
            userLogin = testRes.data.login;
        }

        if (currentRepo && currentRepo !== 'owner/repo') {
            await axios.get(`https://api.github.com/repos/${currentRepo}`, {
                headers: {
                    ...(currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {}),
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'github-organizer'
                },
                timeout: 10000
            });
        }

        localGithub = {
            ...localGithub,
            ...(currentToken ? { token: currentToken, login: userLogin } : {}),
            ...(currentRepo ? { repository: currentRepo } : {}),
            updatedAt: new Date().toISOString()
        };
        saveJsonFile(GITHUB_CONFIG_FILE, localGithub);
        issuesCacheByRepo.clear();

        res.json({
            success: true,
            message: `Configurações salvas com sucesso!${userLogin ? ' Autenticado como @' + userLogin + '.' : ''}${currentRepo ? ' Repositório: ' + currentRepo : ''}`,
            user: userLogin,
            repository: currentRepo,
            maskedToken: maskToken(currentToken)
        });
    } catch (err) {
        console.error('Erro ao validar token/repositório do GitHub:', err.response?.data || err.message);
        const errMsg = err.response?.status === 401 
            ? 'Token inválido ou expirado (Bad credentials).'
            : (err.response?.status === 404 ? 'Sem acesso ao repositório informado ou recurso não encontrado (404).' : (err.response?.data?.message || err.message));
        res.status(400).json({ success: false, error: errMsg });
    }
});

app.post('/api/github/test', async (req, res) => {
    try {
        const token = (req.body?.token && req.body.token.trim()) || getGitHubToken(req);
        const targetRepo = (req.body?.repository && req.body.repository.trim()) || getRepo(req);

        if (!token) {
            return res.status(400).json({ success: false, error: 'Nenhum token fornecido ou configurado.' });
        }

        const t0 = Date.now();
        const userRes = await axios.get('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'github-organizer'
            },
            timeout: 10000
        });

        let repoRes = null;
        if (targetRepo && targetRepo !== 'owner/repo') {
            repoRes = await axios.get(`https://api.github.com/repos/${targetRepo}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'github-organizer'
                },
                timeout: 10000
            });
        }
        const latencyMs = Date.now() - t0;

        res.json({
            success: true,
            user: userRes.data.login,
            repository: repoRes ? repoRes.data.full_name : targetRepo,
            permissions: repoRes ? (repoRes.data.permissions || {}) : {},
            latencyMs
        });
    } catch (err) {
        console.error('Erro ao testar token:', err.response?.data || err.message);
        const errMsg = err.response?.status === 401 
            ? 'Token inválido ou expirado.'
            : (err.response?.status === 404 ? `Repositório ${req.body?.repository || getRepo(req)} não encontrado ou sem permissão de acesso.` : err.message);
        res.status(400).json({ success: false, error: errMsg });
    }
});

// -------------------------------------------------------------
// ROTAS DE CONFIGURAÇÃO E TESTE DE IA
// -------------------------------------------------------------
app.get('/api/ai/config', (req, res) => {
    const config = getAIConfig();
    res.json(config);
});

app.post('/api/ai/config', (req, res) => {
    try {
        const current = getAIConfig();
        const incoming = req.body;

        const merged = {
            enabled: incoming.enabled !== undefined ? incoming.enabled : current.enabled,
            provider: incoming.provider || current.provider,
            ollama: {
                ...current.ollama,
                ...(incoming.ollama || {})
            },
            gemini: {
                ...current.gemini,
                ...(incoming.gemini || {})
            },
            opencode: {
                ...current.opencode,
                ...(incoming.opencode || {})
            },
            prompts: {
                ...current.prompts,
                ...(incoming.prompts || {})
            }
        };

        saveAIConfig(merged);
        res.json({ success: true, config: merged });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao salvar configuração de IA: ' + e.message });
    }
});

// Regera tudo: limpa cache local de resumos para que todos sejam regerados com o novo prompt
app.post('/api/ai/regenerate-all', async (req, res) => {
    try {
        saveJsonFile(SUMMARIES_CACHE_FILE, {});
        res.json({ 
            success: true, 
            message: 'Cache de resumos de IA limpo com sucesso! As issues serão processadas com os novos prompts.' 
        });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao limpar cache de resumos: ' + e.message });
    }
});

app.post('/api/ai/test', async (req, res) => {
    const testConfig = req.body || getAIConfig();
    const t0 = Date.now();
    try {
        const aiRes = await callAI('Responda apenas com a palavra CONEXAO_OK.', 'Você é um assistente técnico testando conexão.', testConfig);
        const latencyMs = Date.now() - t0;

        if (aiRes.text && (aiRes.provider === testConfig.provider || testConfig.provider === 'heuristic')) {
            res.json({
                success: true,
                message: `Conexão bem-sucedida com [${aiRes.providerInfo}]!`,
                provider: aiRes.provider,
                providerInfo: aiRes.providerInfo,
                latencyMs,
                responseSample: aiRes.text
            });
        } else if (aiRes.provider === 'disabled') {
            res.json({
                success: false,
                error: 'A IA está desativada no interruptor.',
                latencyMs
            });
        } else {
            res.json({
                success: false,
                error: aiRes.authNote || 'O servidor de IA não retornou resposta válida. Verifique a URL, modelo e credenciais.',
                provider: aiRes.provider,
                latencyMs
            });
        }
    } catch (err) {
        res.json({
            success: false,
            error: err.response?.data?.message || err.message,
            status: err.response?.status,
            latencyMs: Date.now() - t0
        });
    }
});

// Lista modelos dinamicamente de acordo com o servidor e credenciais
app.post('/api/ai/models', async (req, res) => {
    const config = req.body || getAIConfig();
    const provider = config.provider || 'ollama';

    try {
        if (provider === 'ollama') {
            const ollama = config.ollama || {};
            const url = (ollama.url || process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
            const apiKey = ollama.apiKey || '';
            const user = ollama.user || '';
            const pass = ollama.password || '';

            const clientName = ollama.clientName || process.env.OLLAMA_CLIENT_NAME || 'github-organizer';

            const reqConfig = { 
                timeout: 15000, 
                headers: {
                    'X-Client-Name': clientName
                } 
            };
            if (user && pass) {
                reqConfig.auth = { username: user, password: pass };
            }
            if (apiKey) {
                reqConfig.headers['Authorization'] = `Bearer ${apiKey}`;
                reqConfig.headers['X-Ollama-Token'] = apiKey;
            }

            const response = await axios.get(`${url}/api/tags`, reqConfig);
            const models = (response.data.models || []).map(m => ({
                id: m.name,
                name: m.name,
                size: m.size ? `${(m.size / (1024 * 1024 * 1024)).toFixed(1)} GB` : null,
                details: m.details?.parameter_size || null
            }));

            return res.json({ success: true, provider: 'ollama', models });
        }

        if (provider === 'gemini') {
            const gemini = config.gemini || {};
            const key = gemini.apiKey;
            if (!key) {
                return res.status(400).json({ success: false, error: 'Chave da API do Google Gemini não informada' });
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
            const response = await axios.get(url, { timeout: 15000 });
            const models = (response.data.models || [])
                .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
                .map(m => ({
                    id: m.name.replace('models/', ''),
                    name: m.displayName || m.name.replace('models/', ''),
                    details: m.description ? m.description.substring(0, 60) + '...' : null
                }));

            return res.json({ success: true, provider: 'gemini', models });
        }

        if (provider === 'opencode') {
            const opencode = config.opencode || {};
            const baseUrl = (opencode.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
            const apiKey = opencode.apiKey;
            if (!apiKey) {
                return res.status(400).json({ success: false, error: 'API Key do OpenCode/OpenAI não informada' });
            }

            const response = await axios.get(`${baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                timeout: 15000
            });
            const models = (response.data.data || []).map(m => ({
                id: m.id,
                name: m.id,
                details: m.owned_by || null
            }));

            return res.json({ success: true, provider: 'opencode', models });
        }

        res.status(400).json({ success: false, error: 'Provedor desconhecido' });
    } catch (err) {
        console.error('[IA] Erro ao listar modelos:', err.message);
        res.status(500).json({
            success: false,
            error: err.response?.data?.error?.message || err.response?.data?.message || err.message,
            status: err.response?.status
        });
    }
});

app.get('/api/ai/titles', (req, res) => {
    const titles = loadJsonFile(SUGGESTED_TITLES_FILE, {});
    res.json(titles);
});

// Iniciar fila de sincronização de títulos (retorna lista de issues pendentes)
app.post('/api/ai/sync-titles/start', async (req, res) => {
    try {
        const titlesCache = loadJsonFile(SUGGESTED_TITLES_FILE, {});
        const allIssues = await getAllIssues();
        
        const openIssues = allIssues.filter(i => i.state === 'open');
        const pendingIssues = [];
        let alreadyUpToDate = 0;

        for (const issue of openIssues) {
            const id = String(issue.number);
            if (!titlesCache[id] || titlesCache[id].originalTitle !== issue.title || !titlesCache[id].suggestedTitle) {
                pendingIssues.push({
                    number: issue.number,
                    title: issue.title
                });
            } else {
                alreadyUpToDate++;
            }
        }

        res.json({
            success: true,
            totalOpen: openIssues.length,
            pendingCount: pendingIssues.length,
            alreadyUpToDate,
            pendingIssues: pendingIssues.map(i => i.number),
            titles: titlesCache
        });
    } catch (e) {
        console.error('Erro ao iniciar fila de títulos:', e.message);
        res.status(500).json({ error: 'Erro ao inicializar fila de títulos: ' + e.message });
    }
});

// Processar um passo da fila de títulos (1 issue por vez para evitar timeout de serverless)
app.post('/api/ai/sync-titles/step', async (req, res) => {
    try {
        const issueNumber = req.body?.issueNumber ? Number(req.body.issueNumber) : null;
        const titlesCache = loadJsonFile(SUGGESTED_TITLES_FILE, {});
        const allIssues = await getAllIssues();

        let targetIssues = [];
        if (issueNumber) {
            const found = allIssues.find(i => i.number === issueNumber);
            if (found) targetIssues.push(found);
        } else {
            const batchSize = Math.min(Number(req.body?.batchSize) || 1, 3);
            for (const issue of allIssues) {
                if (issue.state !== 'open') continue;
                const id = String(issue.number);
                if (!titlesCache[id] || titlesCache[id].originalTitle !== issue.title || !titlesCache[id].suggestedTitle) {
                    targetIssues.push(issue);
                    if (targetIssues.length >= batchSize) break;
                }
            }
        }

        if (targetIssues.length === 0) {
            return res.json({
                success: true,
                done: true,
                processedCount: 0,
                message: 'Nenhuma issue pendente na fila.',
                titles: titlesCache
            });
        }

        const processed = [];
        for (const issue of targetIssues) {
            const id = String(issue.number);
            let suggested;
            try {
                suggested = await generateSuggestedTitle(issue);
            } catch (err) {
                console.error(`Erro ao gerar título para issue #${issue.number}:`, err.message);
                suggested = heuristicCleanTitle(issue.title);
            }

            titlesCache[id] = {
                number: issue.number,
                originalTitle: issue.title,
                suggestedTitle: suggested,
                status: 'suggested',
                updatedAt: new Date().toISOString()
            };

            processed.push(titlesCache[id]);
        }

        // Salva incrementalmente para não perder progresso
        saveJsonFile(SUGGESTED_TITLES_FILE, titlesCache);

        res.json({
            success: true,
            done: false,
            processedCount: processed.length,
            processed,
            titles: titlesCache
        });
    } catch (e) {
        console.error('Erro no passo da fila de títulos:', e.message);
        res.status(500).json({ error: 'Erro no processamento da fila de títulos: ' + e.message });
    }
});

// Endpoint legado/direto com salvaguarda contra timeout
app.post('/api/ai/sync-titles', async (req, res) => {
    try {
        const issueNumber = req.body?.issueNumber ? Number(req.body.issueNumber) : null;
        if (issueNumber || req.body?.step || req.query?.step) {
            const titlesCache = loadJsonFile(SUGGESTED_TITLES_FILE, {});
            const allIssues = await getAllIssues();
            const issue = allIssues.find(i => i.number === issueNumber);
            if (issue) {
                const suggested = await generateSuggestedTitle(issue);
                titlesCache[String(issue.number)] = {
                    number: issue.number,
                    originalTitle: issue.title,
                    suggestedTitle: suggested,
                    status: 'suggested',
                    updatedAt: new Date().toISOString()
                };
                saveJsonFile(SUGGESTED_TITLES_FILE, titlesCache);
                return res.json({ success: true, processed: [titlesCache[String(issue.number)]], titles: titlesCache });
            }
        }
        // Limita a no máximo 5 issues por chamada direta para evitar 504 Gateway Timeout
        const titles = await syncAllSuggestedTitles(5);
        res.json({ success: true, count: Object.keys(titles).length, titles });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao sincronizar títulos com IA: ' + e.message });
    }
});

// Estatísticas do Dashboard com persistência local e cálculo de horas por IA
app.get('/api/stats', async (req, res) => {
    try {
        const forceSync = req.query.sync === 'true' || req.query.refresh === 'true';

        if (!forceSync) {
            const localCached = loadJsonFile(DASHBOARD_CACHE_FILE, null);
            if (localCached && localCached.openIssues !== undefined) {
                return res.json(localCached);
            }
        }

        const allIssues = await getAllIssues(true);
        const openIssuesCount = allIssues.filter(i => i.state === 'open').length;
        const closedIssuesCount = allIssues.filter(i => i.state === 'closed').length;
        const totalIssuesCount = openIssuesCount + closedIssuesCount;
        const resolutionRate = totalIssuesCount > 0 
            ? Math.round((closedIssuesCount / totalIssuesCount) * 100) 
            : 0;

        let commitActivity = [];
        try {
            const commitsRes = await api.get('/stats/commit_activity');
            if (Array.isArray(commitsRes.data)) {
                commitActivity = commitsRes.data;
            }
        } catch (e) {
            console.warn('commit_activity pendente ou indisponível:', e.message);
        }

        const now = new Date();
        const monthsList = [];
        const monthsNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        
        for (let i = 11; i >= 0; i--) {
            const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const key = `${y}-${m}`;
            const label = `${monthsNames[d.getUTCMonth()]}/${String(y).slice(-2)}`;
            monthsList.push({ key, label, year: y, month: d.getUTCMonth(), commits: 0, issuesCreated: 0, issuesClosed: 0 });
        }

        const monthsMap = new Map();
        monthsList.forEach(m => monthsMap.set(m.key, m));

        let totalCommitsLastYear = 0;
        if (Array.isArray(commitActivity) && commitActivity.length > 0) {
            commitActivity.forEach(w => {
                totalCommitsLastYear += w.total;
                const weekDate = new Date(w.week * 1000);
                const y = weekDate.getUTCFullYear();
                const m = String(weekDate.getUTCMonth() + 1).padStart(2, '0');
                const key = `${y}-${m}`;
                const target = monthsMap.get(key);
                if (target) {
                    target.commits += w.total;
                }
            });
        }

        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
        let createdLast30d = 0;
        let closedLast30d = 0;
        const monthIssues = [];

        allIssues.forEach(issue => {
            const cDate = new Date(issue.created_at);
            const cKey = `${cDate.getUTCFullYear()}-${String(cDate.getUTCMonth() + 1).padStart(2, '0')}`;
            const targetCreated = monthsMap.get(cKey);
            if (targetCreated) {
                targetCreated.issuesCreated++;
            }
            if (cDate >= thirtyDaysAgo) {
                createdLast30d++;
                monthIssues.push(issue);
            }

            if (issue.closed_at) {
                const clDate = new Date(issue.closed_at);
                const clKey = `${clDate.getUTCFullYear()}-${String(clDate.getUTCMonth() + 1).padStart(2, '0')}`;
                const targetClosed = monthsMap.get(clKey);
                if (targetClosed) {
                    targetClosed.issuesClosed++;
                }
                if (clDate >= thirtyDaysAgo) {
                    closedLast30d++;
                    if (!monthIssues.includes(issue)) monthIssues.push(issue);
                }
            }
        });

        const rawMonthCommits = await getCommitsForRange(thirtyDaysAgo, now, true);
        const hoursEstimation = await calculateEstimatedMonthlyHours(monthIssues, rawMonthCommits);

        const dashboardData = {
            openIssues: openIssuesCount,
            closedIssues: closedIssuesCount,
            totalIssues: totalIssuesCount,
            resolutionRate,
            totalCommits: totalCommitsLastYear,
            recent30Days: {
                created: createdLast30d,
                closed: closedLast30d
            },
            estimatedHours: hoursEstimation,
            monthlyData: monthsList,
            commitActivity,
            lastSyncedAt: new Date().toISOString()
        };

        saveJsonFile(DASHBOARD_CACHE_FILE, dashboardData);
        res.json(dashboardData);
    } catch (error) {
        console.error('Erro ao buscar stats:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

// Analytics com timeline e filtros
app.get('/api/analytics', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === 'true';
        const period = req.query.period || '30d';
        const milestoneFilter = req.query.milestone || 'all';

        const now = new Date();
        let startDate;
        let endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

        if (period === '7d') {
            startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
        } else if (period === '14d') {
            startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 13));
        } else if (period === '30d') {
            startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
        } else if (period === '90d') {
            startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 89));
        } else if (period === '180d') {
            startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 179));
        } else if (period === '365d') {
            startDate = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()));
        } else if (period === 'custom' && req.query.startDate && req.query.endDate) {
            const [sy, sm, sd] = req.query.startDate.split('-').map(Number);
            const [ey, em, ed] = req.query.endDate.split('-').map(Number);
            startDate = new Date(Date.UTC(sy, sm - 1, sd));
            endDate = new Date(Date.UTC(ey, em - 1, ed, 23, 59, 59, 999));
        } else {
            startDate = new Date(Date.UTC(2023, 0, 1));
        }

        const diffDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
        let groupBy = req.query.groupBy;
        if (!groupBy || groupBy === 'auto') {
            if (diffDays <= 31) groupBy = 'day';
            else if (diffDays <= 120) groupBy = 'week';
            else groupBy = 'month';
        }

        const allIssues = await getAllIssues(forceRefresh);

        if (period === 'all' && allIssues.length > 0) {
            let earliest = new Date();
            allIssues.forEach(i => {
                const cDate = new Date(i.created_at);
                if (cDate < earliest) earliest = cDate;
            });
            startDate = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1));
        }

        const rawCommits = await getCommitsForRange(startDate, endDate, forceRefresh);
        const monthsNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const buckets = [];
        const map = new Map();

        if (groupBy === 'day') {
            let cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
            const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
            while (cur <= end) {
                const key = cur.toISOString().slice(0, 10);
                const label = String(cur.getUTCDate()).padStart(2, '0') + '/' + String(cur.getUTCMonth() + 1).padStart(2, '0');
                const b = { key, label, fullDate: key, issuesCreated: 0, issuesClosed: 0, commits: 0, net: 0 };
                buckets.push(b);
                map.set(key, b);
                cur.setUTCDate(cur.getUTCDate() + 1);
            }
        } else if (groupBy === 'week') {
            let cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
            const day = cur.getUTCDay();
            const diff = cur.getUTCDate() - day + (day === 0 ? -6 : 1);
            cur.setUTCDate(diff);
            const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
            while (cur <= end) {
                const key = cur.toISOString().slice(0, 10);
                const label = 'Sem ' + String(cur.getUTCDate()).padStart(2, '0') + '/' + String(cur.getUTCMonth() + 1).padStart(2, '0');
                const b = { key, label, fullDate: key, issuesCreated: 0, issuesClosed: 0, commits: 0, net: 0 };
                buckets.push(b);
                map.set(key, b);
                cur.setUTCDate(cur.getUTCDate() + 7);
            }
        } else if (groupBy === 'month') {
            let cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
            const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
            while (cur <= end) {
                const y = cur.getUTCFullYear();
                const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
                const key = y + '-' + m;
                const label = monthsNames[cur.getUTCMonth()] + '/' + String(y).slice(-2);
                const b = { key, label, fullDate: key, issuesCreated: 0, issuesClosed: 0, commits: 0, net: 0 };
                buckets.push(b);
                map.set(key, b);
                cur.setUTCMonth(cur.getUTCMonth() + 1);
            }
        }

        function getBucketKey(d) {
            if (groupBy === 'day') return d.toISOString().slice(0, 10);
            if (groupBy === 'month') return d.toISOString().slice(0, 7);
            const cd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
            const day = cd.getUTCDay();
            const diff = cd.getUTCDate() - day + (day === 0 ? -6 : 1);
            cd.setUTCDate(diff);
            return cd.toISOString().slice(0, 10);
        }

        const milestonesMap = new Map();
        allIssues.forEach(i => {
            if (i.milestone) {
                milestonesMap.set(String(i.milestone.id), {
                    id: String(i.milestone.id),
                    number: i.milestone.number,
                    title: i.milestone.title,
                    state: i.milestone.state
                });
            }
        });
        const milestonesList = Array.from(milestonesMap.values()).sort((a, b) => a.title.localeCompare(b.title));

        const issuesCreatedList = [];
        const issuesClosedList = [];
        let totalResolutionTimeMs = 0;
        let closedWithDurationCount = 0;

        allIssues.forEach(issue => {
            if (milestoneFilter !== 'all') {
                if (!issue.milestone || String(issue.milestone.id) !== String(milestoneFilter)) {
                    return;
                }
            }

            const createdAt = new Date(issue.created_at);
            const closedAt = issue.closed_at ? new Date(issue.closed_at) : null;

            const issueFormatted = {
                number: issue.number,
                title: issue.title,
                state: issue.state,
                created_at: issue.created_at,
                closed_at: issue.closed_at,
                html_url: issue.html_url,
                user: { login: issue.user?.login || 'Autor', avatar_url: issue.user?.avatar_url || '' },
                labels: (issue.labels || []).map(l => typeof l === 'string' ? { name: l, color: 'e2e8f0' } : { name: l.name, color: l.color || 'e2e8f0' }),
                milestone: issue.milestone ? { id: issue.milestone.id, title: issue.milestone.title, number: issue.milestone.number } : null,
                comments: issue.comments || 0
            };

            if (createdAt >= startDate && createdAt <= endDate) {
                issuesCreatedList.push(issueFormatted);
                const b = map.get(getBucketKey(createdAt));
                if (b) b.issuesCreated++;
            }

            if (closedAt && closedAt >= startDate && closedAt <= endDate) {
                const resolutionHours = Math.max(0, Math.round((closedAt - createdAt) / (1000 * 3600)));
                const resolutionDays = (resolutionHours / 24).toFixed(1);
                totalResolutionTimeMs += (closedAt - createdAt);
                closedWithDurationCount++;

                issuesClosedList.push({ ...issueFormatted, resolutionHours, resolutionDays });
                const b = map.get(getBucketKey(closedAt));
                if (b) b.issuesClosed++;
            }
        });

        const commitsList = [];
        rawCommits.forEach(c => {
            const cDate = new Date(c.commit.author.date);
            if (cDate >= startDate && cDate <= endDate) {
                commitsList.push({
                    sha: c.sha.substring(0, 7),
                    fullSha: c.sha,
                    message: c.commit.message.split('\n')[0],
                    author: c.commit.author.name || c.author?.login || 'Autor',
                    authorAvatar: c.author?.avatar_url || null,
                    date: c.commit.author.date,
                    html_url: c.html_url
                });

                const b = map.get(getBucketKey(cDate));
                if (b) b.commits++;
            }
        });

        buckets.forEach(b => {
            b.net = b.issuesCreated - b.issuesClosed;
        });

        issuesCreatedList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        issuesClosedList.sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));
        commitsList.sort((a, b) => new Date(b.date) - new Date(a.date));

        const totalCreated = issuesCreatedList.length;
        const totalClosed = issuesClosedList.length;
        const totalCommits = commitsList.length;
        const netIssues = totalCreated - totalClosed;
        const resolutionRate = totalCreated > 0 ? Math.round((totalClosed / totalCreated) * 100) : (totalClosed > 0 ? 100 : 0);
        const avgResolutionDays = closedWithDurationCount > 0 
            ? ((totalResolutionTimeMs / closedWithDurationCount) / (1000 * 3600 * 24)).toFixed(1) 
            : '0';

        const summariesCache = loadJsonFile(SUMMARIES_CACHE_FILE, {});

        const enrichedCreated = issuesCreatedList.map(i => ({
            ...i,
            summary: summariesCache[String(i.number)]?.summary || null
        }));

        const enrichedClosed = issuesClosedList.map(i => ({
            ...i,
            summary: summariesCache[String(i.number)]?.summary || null
        }));

        res.json({
            repository: getRepo(req),
            periodInfo: { period, groupBy, startDate: startDate.toISOString().slice(0, 10), endDate: endDate.toISOString().slice(0, 10), diffDays },
            summary: {
                totalIssuesCreated: totalCreated,
                totalIssuesClosed: totalClosed,
                issuesCreated: totalCreated, // compatibilidade com frontend
                issuesClosed: totalClosed,   // compatibilidade com frontend
                netIssues,
                resolutionRate,
                avgResolutionDays,
                totalCommits,
                totalRepoOpenIssues: allIssues.filter(i => i.state === 'open').length,
                totalRepoClosedIssues: allIssues.filter(i => i.state === 'closed').length
            },
            milestones: milestonesList,
            timeline: buckets,
            series: buckets.map(b => ({
                ...b,
                created: b.issuesCreated,
                closed: b.issuesClosed
            })), // compatibilidade com frontend
            details: {
                issuesCreated: enrichedCreated,
                issuesClosed: enrichedClosed,
                commits: commitsList
            }
        });

    } catch (error) {
        console.error('Erro ao gerar analytics:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao gerar dados de analytics do GitHub', details: error.message });
    }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Organizador rodando em http://localhost:${PORT}`);
    });
}

module.exports = app;
