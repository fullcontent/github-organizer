# 🚀 Celic Organizer

Plataforma inteligente para gerenciamento e organização visual de issues, prioridades, milestones e métricas de desenvolvimento do repositório **`fullcontent/sistemacelic`** com integração de Inteligência Artificial e modo escuro (Dark Mode).

---

## 🌟 Funcionalidades Principais

1. **📋 Listagem Geral de Issues (`/`):**
   - **Seleção de Milestone em Linha:** Atribua ou remova milestones diretamente na tabela de cada issue.
   - **Layout em Linha Única:** Tabela horizontal compacta, de alta densidade e com espaçamento otimizado.
   - **Largura Estendida:** Interface em tela cheia (`96%`) para melhor aproveitamento do espaço.
   - **Modo Dark / Light:** Alternância com um clique no botão do sol/lua (☀️/🌙) e persistência automática.

2. **📌 Kanban de Prioridades (`/kanban.html`):**
   - **Painel Dividido:** Coluna lateral esquerda dedicada para issues **Sem Prioridade (Backlog)** com busca em tempo real, e quadro à direita com as categorias de prioridade (**P3 - Low**, **P2 - Medium**, **P1 - High**, **P0 - Critical**).
   - **Cards Compactos (Máx. 2 Linhas):** Visualização geral de dezenas de tarefas simultaneamente sem rolagem excessiva.
   - **🤖 Explicação por IA em 1 Parágrafo (Modal):** Ao clicar sobre qualquer card do kanban, abre-se um modal técnico explicando do que se trata a issue, a necessidade/problema e o impacto esperado, gerado via IA.

3. **📊 Dashboard Gestor & Estimativa de Horas (`/dashboard.html`):**
   - **💾 Persistência Local Inteligente:** Os dados e métricas ficam salvos localmente em `data/dashboard_cache.json` para carregamento instantâneo.
   - **🔄 Sincronização Sob Demanda:** Ao clicar em **"Sincronizar Dados (IA)"**, a plataforma consulta o GitHub e processa a análise de esforço.
   - **⏱️ Estimativa de Horas Trabalhadas no Mês:** A IA avalia a complexidade do texto das issues trabalhadas no mês juntamente com o volume de commits e arquivos alterados, calculando uma média ponderada das horas de desenvolvimento da equipe.
   - **Gráficos Executivos:** Commits mensais, proporção de issues e fluxo de trabalho (criadas x concluídas).

4. **📈 Gráficos & Métricas Avançadas (`/analytics.html`):**
   - Filtros por período (7d, 14d, 30d, 90d, 6 meses, 1 ano, customizado).
   - Agrupamento por dia, semana ou mês.
   - Alternância entre barras e linhas.
   - Detalhamento de cada issue e commit com links diretos.

---

## 🚀 Como Executar o Projeto

### Pré-requisitos
- Node.js (versão 18 ou superior)
- Git / GitHub CLI (`gh`) autenticado **OU** um Token de Acesso Pessoal (PAT) do GitHub

### 1. Instalação das Dependências
No terminal do projeto, execute:
```bash
npm install
```

### 2. Configuração do `.env`
Crie ou edite o arquivo `.env` na raiz do projeto:
```bash
cp .env.example .env
```

---

## ⚙️ Configuração da Inteligência Artificial

A plataforma suporta múltiplos provedores de IA com fallback automático para motor analítico integrado:

### Opção 1: Ollama Privado com Proxy (Ex: `ollama.ambialles.com` ou Tailscale)
Se você utiliza seu próprio servidor Ollama com o proxy de métricas e controle de clientes:

1. **Escolha o nome do cliente/projeto:** Ex: `celic-organizer` ou `meu-projeto`. Esse nome aparecerá no painel de monitoramento do Ollama na tabela "Por cliente".
2. **Aponte para o proxy (porta 11435, não para a 11434):**
   - **Pela Tailscale:** `http://100.70.63.0:11435`
   - **Pelo domínio:** `https://ollama.ambialles.com` (continuando com o `X-Ollama-Token`)
3. **Envio do nome do cliente em todas as chamadas:**
   - O sistema envia automaticamente o cabeçalho HTTP:
     ```http
     X-Client-Name: celic-organizer
     ```
4. **Configuração via Interface ou `.env`:**
   - **Pela Interface Web:** No modal de configuração de IA (ícone de engrenagem), preencha o campo **"Nome do Cliente / Projeto"** e selecione a URL desejada.
   - **No arquivo `.env`:**
     ```env
     OLLAMA_URL=http://100.70.63.0:11435
     # ou OLLAMA_URL=https://ollama.ambialles.com
     OLLAMA_CLIENT_NAME=celic-organizer
     OLLAMA_MODEL=gemma3:12b
     OLLAMA_API_KEY=***REMOVED-SECRET***
     ```
5. **Streaming com API compatível com OpenAI:** Para medir tokens em streaming quando utilizar endpoints OpenAI, envie `"stream_options": { "include_usage": true }`.
6. **Confirmação no painel:** Após testar ou fazer uma chamada, aguarde o card "Em andamento agora" no painel do proxy e confira se o cliente aparece registrado na tabela "Por cliente".

> 💡 **Nota:** Se as credenciais do Ollama não forem informadas ou estiverem incorretas, o sistema continuará funcionando utilizando o **Motor Analítico Heurístico**, indicando uma nota no modal.

---

### Opção 2: Google Gemini (Gratuito e Rápido)
Se preferir utilizar a API do Google Gemini:
1. Obtenha uma chave gratuita no [Google AI Studio](https://aistudio.google.com/).
2. Adicione ao `.env`:
   ```env
   GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxx
   GEMINI_MODEL=gemini-1.5-flash
   ```

---

### Opção 3: OpenCode / OpenAI Compatible
Se utilizar um gateway compatível com OpenAI:
```env
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

---

## 🔑 Configuração do GitHub

O sistema obtém o token automaticamente do seu ambiente através de 4 métodos (em ordem de prioridade):
1. `GITHUB_TOKEN` definido no `.env`
2. `GITHUB_TOKEN_CLASSIC` no `.env`
3. `GITHUB_TOKEN_FINE` no `.env`
4. **GitHub CLI da sua máquina:** Se você estiver logado com `gh auth login`, o sistema utiliza o token automaticamente sem precisar configurar nada!

Exemplo no `.env`:
```env
GITHUB_TOKEN=***REMOVED-SECRET***
```

---

## 🏃 Iniciando a Aplicação

Para iniciar o servidor:
```bash
npm start
```
Ou em modo de desenvolvimento:
```bash
npm run dev
```

Acesse no seu navegador:
- **Lista de Issues:** [http://localhost:3000/](http://localhost:3000/)
- **Kanban de Prioridades:** [http://localhost:3000/kanban.html](http://localhost:3000/kanban.html)
- **Dashboard Gestor:** [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html)
- **Gráficos & Métricas:** [http://localhost:3000/analytics.html](http://localhost:3000/analytics.html)

---

## 📐 Como Funciona o Cálculo de Horas do Mês

Quando a sincronização é disparada no **Dashboard Gestor**:
1. O backend coleta todas as issues movimentadas ou criadas no último mês.
2. O backend coleta os commits do mês e analisa a amostragem de volume de arquivos alterados e linhas modificadas.
3. Os dados são enviados ao modelo de IA (ou processados pelo motor heurístico calibrado) com os seguintes critérios:
   - **Componente de Issues:** Avalia a complexidade do escopo textual, requisitos, labels (bug vs feature vs refatoração) e prioridades (P0/P1/P2/P3).
   - **Componente de Commits:** Avalia o volume de arquivos modificados, quantidade de adições/remoções de código e frequência de entregas.
   - **Média Ponderada:** Gera a estimativa final em horas com parágrafo analítico justificando o cálculo.
4. O resultado é armazenado em `data/dashboard_cache.json`, garantindo visualização instantânea nas visitas seguintes.
