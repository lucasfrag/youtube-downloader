const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const youtubedl = require('youtube-dl-exec');

// Detects locally installed browsers we can borrow cookies from, so yt-dlp can
// authenticate as the user when YouTube demands bot-check verification.
// Firefox is tried first on Windows: Chrome/Edge's "App-Bound Encryption" often
// makes yt-dlp fail to decrypt their cookies via DPAPI, while Firefox's are plain.
function detectAvailableBrowsers() {
  const candidates = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    const roaming = process.env.APPDATA;
    if (roaming) {
      candidates.push({ name: 'firefox', path: path.join(roaming, 'Mozilla', 'Firefox') });
    }
    if (local) {
      candidates.push({ name: 'edge', path: path.join(local, 'Microsoft', 'Edge', 'User Data') });
      candidates.push({ name: 'chrome', path: path.join(local, 'Google', 'Chrome', 'User Data') });
      candidates.push({ name: 'brave', path: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') });
    }
  } else if (process.platform === 'darwin') {
    const home = require('os').homedir();
    candidates.push({ name: 'firefox', path: path.join(home, 'Library', 'Application Support', 'Firefox') });
    candidates.push({ name: 'chrome', path: path.join(home, 'Library', 'Application Support', 'Google', 'Chrome') });
  } else {
    const home = require('os').homedir();
    candidates.push({ name: 'firefox', path: path.join(home, '.mozilla', 'firefox') });
    candidates.push({ name: 'chrome', path: path.join(home, '.config', 'google-chrome') });
  }
  return candidates.filter((c) => fs.existsSync(c.path)).map((c) => c.name);
}

function looksLikeBotCheck(stderrText) {
  return /sign in to confirm|not a bot|cookies/i.test(stderrText || '');
}

function extractErrorSummary(stderrText, fallbackMessage) {
  if (stderrText) {
    const errorLines = [...stderrText.matchAll(/^ERROR:\s*(.+)$/gm)].map((m) => m[1]);
    if (errorLines.length > 0) {
      const unique = [...new Set(errorLines)];
      return unique.slice(0, 3).join(' | ').slice(0, 500);
    }
  }
  return (fallbackMessage || 'erro desconhecido').split('\n')[0].slice(0, 300);
}

const BOT_CHECK_MESSAGE =
  'O YouTube exigiu verificação de "não sou um robô" e não foi possível autenticar automaticamente. ' +
  'Feche o Chrome/Edge por completo e tente de novo, ou exporte os cookies do YouTube (extensão "Get cookies.txt") ' +
  `e salve o arquivo como cookies.txt em ${__dirname}.`;

// Fetches yt-dlp metadata, retrying with cookies (a cookies.txt file, then each
// detected browser) when YouTube responds with its bot-check error.
async function fetchYoutubeInfo(url) {
  const baseOpts = { dumpSingleJson: true, noWarnings: true, noCallHome: true, flatPlaylist: true, skipDownload: true, jsRuntimes: 'node' };
  const cookieOptions = [];
  if (fs.existsSync(COOKIES_FILE)) cookieOptions.push({ cookies: COOKIES_FILE });
  for (const browser of detectAvailableBrowsers()) cookieOptions.push({ cookiesFromBrowser: browser });

  try {
    return await youtubedl(url, baseOpts);
  } catch (err) {
    if (!looksLikeBotCheck(err.stderr || err.message)) throw err;
    for (const cookieOpt of cookieOptions) {
      try {
        return await youtubedl(url, { ...baseOpts, ...cookieOpt });
      } catch {
        // try the next cookie source
      }
    }
    throw new Error(BOT_CHECK_MESSAGE);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const COOKIES_FILE = path.join(__dirname, 'cookies.txt');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory job registry: jobId -> { status, progress, message, filePath, isPlaylist, title }
const jobs = new Map();

function isValidYoutubeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host);
  } catch {
    return false;
  }
}

// Fetch metadata about a video or playlist without downloading
app.post('/api/info', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !isValidYoutubeUrl(url)) {
    return res.status(400).json({ error: 'URL do YouTube inválida.' });
  }

  try {
    const info = await fetchYoutubeInfo(url);

    const isPlaylist = Array.isArray(info.entries);
    res.json({
      isPlaylist,
      title: info.title,
      thumbnail: info.thumbnail || (isPlaylist && info.entries[0] && info.entries[0].thumbnail) || null,
      count: isPlaylist ? info.entries.length : 1,
      uploader: info.uploader || info.channel || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message === BOT_CHECK_MESSAGE ? err.message : 'Não foi possível obter informações do vídeo/playlist.' });
  }
});

// Start a download job
app.post('/api/download', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !isValidYoutubeUrl(url)) {
    return res.status(400).json({ error: 'URL do YouTube inválida.' });
  }

  const jobId = crypto.randomUUID();
  const jobDir = path.join(DOWNLOADS_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  jobs.set(jobId, {
    status: 'starting',
    progress: 0,
    message: 'Iniciando...',
    filePath: null,
    fileName: null,
    isPlaylist: false,
    title: null,
  });

  res.json({ jobId });

  runDownload(jobId, url, jobDir).catch((err) => {
    console.error('Download job failed:', err);
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.message = 'Falha ao baixar: ' + (err.message || 'erro desconhecido');
    }
  });
});

async function runDownload(jobId, url, jobDir) {
  const job = jobs.get(jobId);

  // Detect if this is a playlist first
  let info;
  try {
    info = await fetchYoutubeInfo(url);
  } catch (err) {
    throw new Error(err.message === BOT_CHECK_MESSAGE ? err.message : 'Não foi possível ler a URL informada.');
  }

  const isPlaylist = Array.isArray(info.entries);
  job.isPlaylist = isPlaylist;
  job.title = info.title;
  job.status = 'downloading';
  job.message = isPlaylist ? `Baixando playlist "${info.title}"...` : `Baixando "${info.title}"...`;

  const outputTemplate = path.join(jobDir, '%(title)s.%(ext)s');
  const totalItems = isPlaylist ? info.entries.length : 1;

  let attempt = await attemptDownload({ url, jobDir, outputTemplate, isPlaylist, totalItems, job });

  let files = fs.readdirSync(jobDir).filter((f) => !f.startsWith('.'));

  if (files.length === 0 && looksLikeBotCheck(attempt.stderrBuf)) {
    if (fs.existsSync(COOKIES_FILE)) {
      job.message = 'O YouTube pediu verificação anti-bot. Tentando novamente com cookies.txt...';
      attempt = await attemptDownload({ url, jobDir, outputTemplate, isPlaylist, totalItems, job, cookies: COOKIES_FILE });
      files = fs.readdirSync(jobDir).filter((f) => !f.startsWith('.'));
    }

    for (const browser of detectAvailableBrowsers()) {
      if (files.length > 0) break;
      job.message = `O YouTube pediu verificação anti-bot. Tentando novamente com cookies do ${browser}...`;
      attempt = await attemptDownload({ url, jobDir, outputTemplate, isPlaylist, totalItems, job, cookiesFromBrowser: browser });
      files = fs.readdirSync(jobDir).filter((f) => !f.startsWith('.'));
    }
  }

  if (files.length === 0) {
    if (looksLikeBotCheck(attempt.stderrBuf)) {
      throw new Error(BOT_CHECK_MESSAGE);
    }
    const summary = extractErrorSummary(attempt.stderrBuf, attempt.execError && attempt.execError.message);
    throw new Error(summary);
  }

  if (isPlaylist) {
    const zipPath = path.join(DOWNLOADS_DIR, `${jobId}.zip`);
    await zipDirectory(jobDir, zipPath);
    job.filePath = zipPath;
    job.fileName = sanitizeFilename(info.title) + '.zip';
  } else {
    const fullPath = path.join(jobDir, files[0]);
    job.filePath = fullPath;
    job.fileName = files[0];
  }

  job.progress = 100;
  job.status = 'done';
  job.message = 'Concluído!';
}

// Runs yt-dlp once, streaming progress into `job`. Never throws: failures are
// reported via the returned stderrBuf/execError so the caller can decide whether
// to retry (e.g. with browser cookies) or give up.
async function attemptDownload({ url, jobDir, outputTemplate, isPlaylist, totalItems, job, cookiesFromBrowser, cookies }) {
  let completedItems = 0;
  let stderrBuf = '';
  let execError = null;

  const subprocess = youtubedl.exec(url, {
    output: outputTemplate,
    format: 'bestvideo*+bestaudio/best',
    mergeOutputFormat: 'mp4',
    remuxVideo: 'mp4',
    ...(isPlaylist ? { yesPlaylist: true } : { noPlaylist: true }),
    ...(cookiesFromBrowser ? { cookiesFromBrowser } : {}),
    ...(cookies ? { cookies } : {}),
    noWarnings: true,
    noCallHome: true,
    newline: true,
    ignoreErrors: true,
    restrictFilenames: true,
    jsRuntimes: 'node',
  });

  subprocess.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    const lines = text.split(/\r|\n/).filter(Boolean);
    for (const line of lines) {
      const percentMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (percentMatch) {
        const filePercent = parseFloat(percentMatch[1]);
        const overall = ((completedItems + filePercent / 100) / totalItems) * 100;
        job.progress = Math.min(99, Math.round(overall));
        job.message = isPlaylist
          ? `Baixando item ${completedItems + 1} de ${totalItems} (${filePercent.toFixed(0)}%)...`
          : `Baixando... ${filePercent.toFixed(0)}%`;
      }
      if (/\[Merger\]|\[VideoRemuxer\]|\[ffmpeg\]/.test(line)) {
        job.message = isPlaylist
          ? `Processando item ${completedItems + 1} de ${totalItems}...`
          : 'Convertendo para MP4...';
      }
      if (/\[Merger\] Merging formats into/.test(line) || /\[VideoRemuxer\] Remuxing video/.test(line)) {
        completedItems += 1;
      }
    }
  });

  subprocess.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
  });

  try {
    await subprocess;
  } catch (err) {
    execError = err;
    if (err.stderr) stderrBuf += err.stderr;
  }

  return { stderrBuf, execError };
}

function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

// Poll job status
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado.' });
  res.json({
    status: job.status,
    progress: job.progress,
    message: job.message,
    isPlaylist: job.isPlaylist,
    title: job.title,
    ready: job.status === 'done',
  });
});

// Download the resulting file
app.get('/api/file/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done' || !job.filePath) {
    return res.status(404).json({ error: 'Arquivo não disponível.' });
  }
  res.download(job.filePath, job.fileName);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`YouTube Downloader rodando em http://127.0.0.1:${PORT}`);
});
