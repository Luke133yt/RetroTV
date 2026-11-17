'use strict';
// Language profiles: UI language (used by the web app), default metadata source
// and the matching Torrentio language filter.
// The web UI strings live in public/i18n.js; here we keep the strings that the
// Stremio/Nuvio addon and the server itself need to show.

const PROFILES = {
  en: {
    name: 'English',
    metaAddon: 'https://v3-cinemeta.strem.io',
    torrentio: 'https://torrentio.strem.fun/language=english/manifest.json',
    addonDescription: 'Your old-school television: channels, schedules and commercials that you create yourself.',
    catalogName: 'RetroTV – My channels',
    onAir: 'On air',
    next: 'Next',
    nothingOnAir: 'Nothing on air right now',
    until: 'until {time}',
    ads: 'Advertisements',
    openWeb: '📺 Open the vintage TV (guide and commercials)\nOpens in your browser',
    nowPlaying: '▶ On air: {title}\nFrom the beginning, without commercials',
    downloadsChannel: 'Downloads',
    downloaded: 'Downloaded',
    libraryEmpty: 'No downloaded videos found. Add a folder in MENU → LIBRARY.',
    serverOn: 'RetroTV is on',
    serverStopped: 'RetroTV has stopped.',
  },
  it: {
    name: 'Italiano',
    metaAddon: 'https://v3-cinemeta.strem.io',
    torrentio: 'https://torrentio.strem.fun/language=italian/manifest.json',
    addonDescription: 'La tua televisione in vecchio stile: canali, palinsesto e pubblicità creati da te.',
    catalogName: 'RetroTV – I miei canali',
    onAir: 'In onda',
    next: 'A seguire',
    nothingOnAir: 'Nessuna trasmissione in questo momento',
    until: 'fino alle {time}',
    ads: 'Pubblicità',
    openWeb: '📺 Apri la TV vintage (con guida e pubblicità)\nSi apre nel browser',
    nowPlaying: "▶ In onda: {title}\nDall'inizio, senza pubblicità",
    downloadsChannel: 'Scaricati',
    downloaded: 'Scaricato',
    libraryEmpty: 'Nessun video scaricato trovato. Aggiungi una cartella in MENU → LIBRERIA.',
    serverOn: 'RetroTV è acceso',
    serverStopped: 'RetroTV si è fermato.',
  },
  es: {
    name: 'Español',
    metaAddon: 'https://v3-cinemeta.strem.io',
    torrentio: 'https://torrentio.strem.fun/language=spanish/manifest.json',
    addonDescription: 'Tu televisión de la vieja escuela: canales, programación y anuncios creados por ti.',
    catalogName: 'RetroTV – Mis canales',
    onAir: 'En emisión',
    next: 'A continuación',
    nothingOnAir: 'No hay nada en emisión ahora mismo',
    until: 'hasta las {time}',
    ads: 'Publicidad',
    openWeb: '📺 Abrir la TV vintage (guía y publicidad)\nSe abre en el navegador',
    nowPlaying: '▶ En emisión: {title}\nDesde el principio, sin publicidad',
    downloadsChannel: 'Descargas',
    downloaded: 'Descargado',
    libraryEmpty: 'No se han encontrado vídeos descargados. Añade una carpeta en MENÚ → BIBLIOTECA.',
    serverOn: 'RetroTV está encendida',
    serverStopped: 'RetroTV se ha detenido.',
  },
  fr: {
    name: 'Français',
    metaAddon: 'https://v3-cinemeta.strem.io',
    torrentio: 'https://torrentio.strem.fun/language=french/manifest.json',
    addonDescription: 'Votre télévision à l’ancienne : chaînes, programmes et publicités créés par vous.',
    catalogName: 'RetroTV – Mes chaînes',
    onAir: 'À l’antenne',
    next: 'À suivre',
    nothingOnAir: 'Aucune diffusion pour le moment',
    until: 'jusqu’à {time}',
    ads: 'Publicité',
    openWeb: '📺 Ouvrir la TV vintage (guide et publicités)\nS’ouvre dans le navigateur',
    nowPlaying: '▶ À l’antenne : {title}\nDepuis le début, sans publicité',
    downloadsChannel: 'Téléchargés',
    downloaded: 'Téléchargé',
    libraryEmpty: 'Aucune vidéo téléchargée trouvée. Ajoutez un dossier dans MENU → BIBLIOTHÈQUE.',
    serverOn: 'RetroTV est allumée',
    serverStopped: 'RetroTV s’est arrêtée.',
  },
  de: {
    name: 'Deutsch',
    metaAddon: 'https://v3-cinemeta.strem.io',
    torrentio: 'https://torrentio.strem.fun/language=german/manifest.json',
    addonDescription: 'Dein Fernsehen von früher: Kanäle, Programm und Werbung, die du selbst gestaltest.',
    catalogName: 'RetroTV – Meine Kanäle',
    onAir: 'Läuft jetzt',
    next: 'Danach',
    nothingOnAir: 'Gerade läuft nichts',
    until: 'bis {time}',
    ads: 'Werbung',
    openWeb: '📺 Den Vintage-TV öffnen (Programm und Werbung)\nÖffnet im Browser',
    nowPlaying: '▶ Läuft jetzt: {title}\nVon Anfang an, ohne Werbung',
    downloadsChannel: 'Downloads',
    downloaded: 'Heruntergeladen',
    libraryEmpty: 'Keine heruntergeladenen Videos gefunden. Füge einen Ordner unter MENÜ → BIBLIOTHEK hinzu.',
    serverOn: 'RetroTV ist an',
    serverStopped: 'RetroTV wurde beendet.',
  },
  pt: {
    name: 'Português',
    metaAddon: 'https://v3-cinemeta.strem.io',
    torrentio: 'https://torrentio.strem.fun/language=portuguese/manifest.json',
    addonDescription: 'A sua televisão à moda antiga: canais, programação e anúncios criados por si.',
    catalogName: 'RetroTV – Os meus canais',
    onAir: 'No ar',
    next: 'A seguir',
    nothingOnAir: 'Nada no ar neste momento',
    until: 'até às {time}',
    ads: 'Publicidade',
    openWeb: '📺 Abrir a TV vintage (guia e publicidade)\nAbre no navegador',
    nowPlaying: '▶ No ar: {title}\nDesde o início, sem publicidade',
    downloadsChannel: 'Transferências',
    downloaded: 'Transferido',
    libraryEmpty: 'Nenhum vídeo transferido encontrado. Adicione uma pasta em MENU → BIBLIOTECA.',
    serverOn: 'A RetroTV está ligada',
    serverStopped: 'A RetroTV parou.',
  },
};

const CODES = Object.keys(PROFILES);
const DEFAULT = 'en';

// Source/audio languages are independent from the interface language: the UI
// can stay in English while metadata, Torrentio and the audio track are Italian.
// Japanese is available here even though RetroTV has no Japanese UI strings.
const SOURCE_PROFILES = {
  en: { name: 'English', torrentioLang: 'english', accept: 'en-GB,en;q=0.9', iso: ['eng', 'en'], titles: ['english', 'inglese'] },
  it: { name: 'Italiano', torrentioLang: 'italian', accept: 'it-IT,it;q=0.9,en;q=0.5', iso: ['ita', 'it'], titles: ['italian', 'italiano'] },
  ja: { name: '日本語', torrentioLang: 'japanese', accept: 'ja-JP,ja;q=0.9,en;q=0.5', iso: ['jpn', 'ja', 'jap'], titles: ['japanese', 'giapponese'] },
  es: { name: 'Español', torrentioLang: 'spanish', accept: 'es-ES,es;q=0.9,en;q=0.5', iso: ['spa', 'es'], titles: ['spanish', 'español', 'spagnolo'] },
  fr: { name: 'Français', torrentioLang: 'french', accept: 'fr-FR,fr;q=0.9,en;q=0.5', iso: ['fra', 'fre', 'fr'], titles: ['french', 'français', 'francese'] },
  de: { name: 'Deutsch', torrentioLang: 'german', accept: 'de-DE,de;q=0.9,en;q=0.5', iso: ['deu', 'ger', 'de'], titles: ['german', 'deutsch', 'tedesco'] },
  pt: { name: 'Português', torrentioLang: 'portuguese', accept: 'pt-PT,pt;q=0.9,en;q=0.5', iso: ['por', 'pt'], titles: ['portuguese', 'português', 'portoghese'] },
};
const SOURCE_CODES = Object.keys(SOURCE_PROFILES);

function normalize(code) {
  const c = String(code || '').toLowerCase().slice(0, 2);
  return PROFILES[c] ? c : DEFAULT;
}

function normalizeSource(code, fallback) {
  const c = String(code || '').toLowerCase().slice(0, 2);
  if (SOURCE_PROFILES[c]) return c;
  const f = String(fallback || '').toLowerCase().slice(0, 2);
  return SOURCE_PROFILES[f] ? f : DEFAULT;
}

function sourceInfo(code, fallback) {
  const c = normalizeSource(code, fallback);
  const p = SOURCE_PROFILES[c];
  return { code: c, ...p, metaAddon: (PROFILES[c] || PROFILES[DEFAULT]).metaAddon,
    torrentio: `https://torrentio.strem.fun/language=${p.torrentioLang}/manifest.json` };
}

function sourceTuple() {
  return SOURCE_CODES.map((code) => sourceInfo(code));
}

function get(code) {
  const c = normalize(code);
  return { code: c, ...PROFILES[DEFAULT], ...PROFILES[c] };
}

function tuple() {
  return CODES.map((code) => ({
    code,
    name: PROFILES[code].name,
    metaAddon: PROFILES[code].metaAddon,
    torrentio: PROFILES[code].torrentio,
  }));
}

module.exports = { CODES, DEFAULT, normalize, get, tuple, PROFILES,
  SOURCE_CODES, normalizeSource, sourceInfo, sourceTuple };

