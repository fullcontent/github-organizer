# 🚀 GitHub Organizer

**GitHub Organizer** é um painel open-source e self-hosted para organizar e priorizar **issues do GitHub** com **Inteligência Artificial**. Ele adiciona a qualquer repositório um **quadro Kanban**, um **gestor de milestones**, um **dashboard gerencial com estimativa de horas** e **gráficos & métricas** — tudo rodando em um servidor Node.js/Express leve, com páginas estáticas simples (sem build, sem lock-in de framework).

🇺🇸 Read in English: [README.md](README.md)

---

## Por que usar o GitHub Organizer?

As Issues do GitHub puro não oferecem:
- Um **Kanban por prioridade** (P0–P3) com coluna de backlog dedicada e busca em tempo real.
- Uma **explicação em 1 parágrafo gerada por IA** para qualquer issue — contexto, problema e impacto esperado.
- Um **dashboard para gestores** que estima as **horas de engenharia do mês** a partir da complexidade das issues e do volume de commits.
- **Gráficos e métricas** com períodos flexíveis (7d/14d/30d/90d/6m/1a/personalizado) e agrupamento por dia/semana/mês.
- **Modo escuro**, **seletor de idioma PT/EN** e páginas estáticas sem dependências, que você pode hospedar onde quiser.

Funciona com **qualquer repositório GitHub** ao qual você tenha acesso — basta apontar para `owner/repo` e um token.

---

## ✨ Funcionalidades

1. **📋 Listagem de Issues (`/`)**
   - Atribuição de milestone e prioridade em linha, direto na tabela.
   - Layout em largura estendida (`96%`), busca/filtro em tempo real por título, número ou label.
   - Alternância de modo Dark / Light com persistência.

2. **📌 Kanban de Prioridades (`/kanban.html`)**
   - Painel dividido: coluna de **Backlog** dedicada (sem prioridade) com busca em tempo real, e quadro com colunas de prioridade (**P3 - Baixa**, **P2 - Média**, **P1 - Alta**, **P0 - Crítica**).
   - Cards compactos (máx. 2 linhas) para visualizar dezenas de issues sem rolagem excessiva.
   - **🤖 Explicação por IA em 1 parágrafo** em modal — clique em qualquer card para ver do que se trata, o problema/necessidade e o impacto esperado.

3. **📊 Dashboard Gestor & Estimativa de Horas (`/dashboard.html`)**
   - **💾 Persistência local inteligente** — dados e métricas ficam em cache em `data/dashboard_cache.json` para carregamento instantâneo.
   - **🔄 Sincronização sob demanda** — clique em "Sincronizar Dados (IA)" para buscar dados novos do GitHub e recalcular a análise de esforço.
   - **⏱️ Estimativa de horas do mês** — a IA avalia a complexidade textual das issues junto com o volume de commits/arquivos alterados para gerar uma média ponderada das horas de desenvolvimento da equipe.
   - **Gráficos executivos** — commits mensais, proporção de issues e fluxo de criadas x concluídas.

4. **📈 Gráficos & Métricas (`/analytics.html`)**
   - Filtros por período (7d, 14d, 30d, 90d, 6 meses, 1 ano, customizado).
   - Agrupamento por dia, semana ou mês.
   - Alternância entre gráficos de barras e linhas.
   - Detalhamento de cada issue e commit com links diretos.

5. **🎯 Milestones (`/milestones.html`)**
   - Quadro estilo Kanban para milestones, com reordenação de colunas por arraste, barras de progresso e datas de entrega.

6. **🌐 Seletor de idioma PT/EN** em todas as páginas (persistido por navegador), além de suporte completo a **modo escuro**.

---

## 🚀 Como Executar o Projeto

### Pré-requisitos
- Node.js 18 ou superior
- Git / GitHub CLI (`gh`) autenticado **ou** um Token de Acesso Pessoal (PAT) do GitHub

### 1. Instalação das Dependências
```bash
npm install
```

### 2. Configuração do `.env`
```bash
cp .env.example .env
```
Edite o `.env` e defina ao menos:
```env
GITHUB_REPO=owner/repo
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. Iniciando a Aplicação
```bash
npm start
```
Ou em modo de desenvolvimento:
```bash
npm run dev
```

Acesse no navegador:
- **Lista de Issues:** [http://localhost:3000/](http://localhost:3000/)
- **Kanban de Prioridades:** [http://localhost:3000/kanban.html](http://localhost:3000/kanban.html)
- **Dashboard Gestor:** [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html)
- **Gráficos & Métricas:** [http://localhost:3000/analytics.html](http://localhost:3000/analytics.html)
- **Milestones:** [http://localhost:3000/milestones.html](http://localhost:3000/milestones.html)

---

## ⚙️ Configuração da Inteligência Artificial

O GitHub Organizer suporta múltiplos provedores de IA com fallback automático para o motor heurístico integrado, caso nenhuma IA esteja configurada ou acessível.

### Opção 1: Ollama próprio (local ou servidor/proxy privado)
Se você roda seu próprio servidor Ollama (localmente, na sua rede, ou detrás de um proxy/Tailscale):

1. **Escolha um nome de cliente/projeto:** ex: `meu-projeto`. É enviado no header `X-Client-Name`, útil se você usa um proxy de monitoramento na frente do Ollama.
2. **Aponte para o seu servidor**, ex: `http://localhost:11434` (padrão) ou a URL privada/proxy que você usa.
3. **Configuração via Interface ou `.env`:**
   - **Pela Interface Web:** abra o modal de Configuração de IA (ícone de engrenagem) e preencha URL, modelo e nome do cliente.
   - **No arquivo `.env`:**
     ```env
     OLLAMA_URL=http://localhost:11434
     OLLAMA_CLIENT_NAME=meu-projeto
     OLLAMA_MODEL=gemma3:12b
     OLLAMA_API_KEY=
     ```
4. **Streaming com API compatível com OpenAI:** para medir tokens em streaming, envie `"stream_options": { "include_usage": true }`.

> 💡 **Nota:** Se as credenciais do Ollama não forem informadas ou estiverem incorretas, o sistema continua funcionando com o **Motor Heurístico Integrado**, indicando isso na interface.

### Opção 2: Google Gemini (gratuito)
1. Obtenha uma chave gratuita no [Google AI Studio](https://aistudio.google.com/).
2. Adicione ao `.env`:
   ```env
   GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxx
   GEMINI_MODEL=gemini-1.5-flash
   ```

### Opção 3: OpenAI / qualquer gateway compatível
```env
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

---

## 🔑 Configuração do GitHub

O sistema obtém o token automaticamente, em ordem de prioridade:
1. `GITHUB_TOKEN` no `.env`
2. `GITHUB_TOKEN_CLASSIC` no `.env`
3. `GITHUB_TOKEN_FINE` no `.env`
4. **GitHub CLI local:** se você estiver logado com `gh auth login`, o token é usado automaticamente, sem configuração adicional.

Você também pode colar/rotacionar um token direto pela interface (Configuração IA → Token do GitHub), que é salvo localmente e nunca é versionado no git.

```env
GITHUB_REPO=owner/repo
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 📐 Como Funciona o Cálculo de Horas do Mês

Quando a sincronização é disparada no **Dashboard Gestor**:
1. O backend coleta todas as issues movimentadas ou criadas no último mês.
2. O backend coleta os commits do mês e analisa a amostragem de volume de arquivos alterados e linhas modificadas.
3. Os dados são enviados ao modelo de IA configurado (ou processados pelo motor heurístico calibrado) com os seguintes critérios:
   - **Componente de Issues:** complexidade do escopo textual, requisitos, labels (bug vs feature vs refatoração) e prioridades (P0/P1/P2/P3).
   - **Componente de Commits:** volume de arquivos modificados, adições/remoções de código e frequência de entregas.
   - **Média Ponderada:** estimativa final em horas com parágrafo analítico justificando o cálculo.
4. O resultado é armazenado em `data/dashboard_cache.json`, garantindo visualização instantânea nas visitas seguintes.

---

## 🔒 Notas de segurança e privacidade

- Todo o estado local em tempo de execução (`data/*.json`) é gerado pela aplicação e fica **fora do controle de versão** (`.gitignore`) por padrão — nada do seu repositório, issues ou chaves de IA é commitado.
- Seu token do GitHub e as chaves de IA ficam salvos apenas em arquivos locais não versionados (`data/github_config.json`, `data/ai_config.json`) ou em variáveis de ambiente — nunca coloque credenciais reais em arquivos que você pretende commitar ou compartilhar.

## 🤝 Contribuindo

Issues e pull requests são bem-vindos. Este projeto não possui dependência de nenhuma empresa, repositório ou infraestrutura específica — foi pensado para funcionar com qualquer repositório GitHub.

## 📄 Licença

ISC
