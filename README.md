# 🎬 YouTube Downloader

Baixe vídeos ou playlists inteiras do YouTube em **MP4**, sempre na **melhor qualidade disponível** — direto do navegador, sem instalar nada complicado.

![status](https://img.shields.io/badge/status-funcionando-brightgreen)
![node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)
![license](https://img.shields.io/badge/uso-pessoal-blue)

<p align="center">
  <img src="https://img.shields.io/badge/YouTube-FF0000?logo=youtube&logoColor=white" alt="YouTube">
  <img src="https://img.shields.io/badge/MP4-Qualidade%20Máxima-black" alt="MP4">
</p>

---

## ✨ O que ele faz

- 📺 Cole o link de um **vídeo único** ou de uma **playlist inteira**
- 🔍 Veja uma prévia antes de baixar (título, canal, miniatura, quantidade de vídeos)
- ⬇️ Baixa sempre no **MP4 de maior qualidade** disponível (vídeo + áudio já mesclados)
- 📦 Playlist inteira? Ele baixa tudo e entrega um único **.zip**
- 📊 Barra de progresso em tempo real, item por item
- 🍪 Contorna sozinho o bloqueio "confirme que você não é um robô" do YouTube, usando cookies do seu navegador (ou um `cookies.txt` exportado)

---

## 🧰 Pré-requisitos

| Ferramenta | Por quê | Link |
|---|---|---|
| **Node.js 18+** | roda o servidor e também funciona como motor de JavaScript do yt-dlp | [nodejs.org](https://nodejs.org) |
| **ffmpeg** | mescla vídeo e áudio em um único MP4 | [ffmpeg.org](https://ffmpeg.org) — precisa estar no `PATH` |

> 💡 O binário do **yt-dlp** é baixado automaticamente durante a instalação — não precisa instalar nada manualmente.

---

## 🚀 Como rodar

```bash
# 1. Instale as dependências (baixa o yt-dlp automaticamente)
npm install

# 2. Suba o servidor
npm start
```

Agora abra **http://localhost:3000** no navegador. 🎉

---

## 📖 Como usar

1. Cole a URL de um vídeo ou playlist do YouTube no campo de texto
2. Clique em **Buscar** para conferir a prévia
3. Clique em **Baixar em MP4 (qualidade máxima)**
4. Acompanhe a barra de progresso
5. Clique em **Salvar arquivo** quando terminar

| Tipo de link | O que você recebe |
|---|---|
| Vídeo único | um arquivo `.mp4` |
| Playlist | um `.zip` com todos os vídeos em `.mp4` |

---

## 🍪 O YouTube pediu "confirme que você não é um robô"?

Isso é uma verificação anti-bot do próprio YouTube, cada vez mais comum para quem baixa vídeos sem estar autenticado. O app já tenta resolver isso sozinho, nesta ordem:

1. Tenta baixar sem autenticação
2. Se for bloqueado, procura um arquivo `cookies.txt` na raiz do projeto
3. Se não achar, tenta usar os cookies do **Firefox**, **Edge**, **Chrome** ou **Brave** instalados na máquina

Na prática, a forma **mais confiável** é gerar o `cookies.txt` manualmente:

1. Instale a extensão **"Get cookies.txt LOCALLY"** no Chrome (autor `astrospark`)
2. Acesse o [youtube.com](https://youtube.com) logado na sua conta
3. Clique no ícone da extensão → **Export**
4. Salve o arquivo exportado como:
   ```
   cookies.txt
   ```
   na raiz do projeto (mesma pasta do `server.js`)
5. Pronto — o app detecta e usa esse arquivo automaticamente na próxima tentativa

> ⚠️ **Esse arquivo dá acesso à sua sessão do YouTube.** Não compartilhe com ninguém e não suba para nenhum repositório (já está protegido no `.gitignore`). Cookies expiram de tempos em tempos — se voltar a falhar, basta exportar de novo.

---

## 📁 Estrutura do projeto

```
youtube-downloader/
├── server.js          # backend (Express + yt-dlp)
├── public/
│   └── index.html     # interface web
├── downloads/         # arquivos baixados (temporário, ignorado no git)
├── cookies.txt         # opcional — cookies de autenticação (ignorado no git)
└── package.json
```

---

## 🛠️ Tecnologias

- **Node.js + Express** — servidor web
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — motor de extração/download (via `youtube-dl-exec`)
- **ffmpeg** — mescla e converte para MP4
- **archiver** — compacta playlists em `.zip`

---

## ⚠️ Uso responsável

Esta ferramenta é para **uso pessoal**. Respeite os Termos de Serviço do YouTube e os direitos autorais dos criadores de conteúdo — baixe apenas o que você tem permissão para baixar.
