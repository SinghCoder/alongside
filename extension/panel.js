import { HOSTED_ORIGIN, isAppOrigin } from './origins.js';
const origin = document.querySelector('#origin');
const frame = document.querySelector('#board');
const status = document.querySelector('#status');
const expand = document.querySelector('#expand');
let binding;
const saved = await chrome.storage.local.get(['origin','panelZoom']);
origin.value = saved.origin || HOSTED_ORIGIN;
const currentWindow = await chrome.windows.getCurrent();
const selectionKey = `selection:${currentWindow.id}`;
let selected;
async function showSource(selection) {
  if (!selection) { return; }
  selected = selection;
  if (selection.error) { status.textContent=selection.error; return; }
  if (binding === selection.binding) { frame.contentWindow.postMessage({type:'alongside:open-activity'},selection.origin); return; }
  try {
    const result = await chrome.runtime.sendMessage({type:'board',binding:selection.binding});
    if (result.error) { throw Error(result.error); }
    binding = selection.binding;
    origin.value = selection.origin;
    frame.src = result.url;
    status.textContent = `Connected: ${selection.title}`;
    expand.disabled = false;
  } catch (error) { status.textContent = error.message; }
}
chrome.storage.onChanged.addListener((changes,area) => {
  if (area === 'session' && changes[selectionKey]) { void showSource(changes[selectionKey].newValue); }
});
await showSource((await chrome.storage.session.get(selectionKey))[selectionKey]);
origin.onchange = async () => {
  try {
    const url = new URL(origin.value);
    if (!isAppOrigin(url.href)) { throw Error("Use Alongside’s hosted address or the local app."); }
    await chrome.storage.local.set({origin:url.origin});
    if (!selected?.tabId) { return; }
    const selection = await chrome.runtime.sendMessage({type:'bind',tabId:selected.tabId,origin:url.origin});
    if (selection.error) { throw Error(selection.error); }
    await chrome.storage.session.set({[selectionKey]:selection});
  } catch (error) { status.textContent=error.message; }
};
expand.onclick = async () => { const result=await chrome.runtime.sendMessage({type:'board',binding});if(result.error){status.textContent=result.error;return;}await chrome.tabs.create({url:result.url}); };

const ZOOM_DEFAULT = 100, ZOOM_MIN = 60, ZOOM_MAX = 140, ZOOM_STEP = 10;
let zoom = ZOOM_DEFAULT;
function setZoom(value) {
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(value) || ZOOM_DEFAULT));
  const scale = zoom / ZOOM_DEFAULT;
  document.body.style.zoom = String(scale);
  document.body.style.width = `${100 / scale}vw`;
  document.body.style.height = `${100 / scale}vh`;
  document.querySelector('#zoom-reset').textContent = `${zoom}%`;
  document.querySelector('#zoom-out').disabled = zoom === ZOOM_MIN;
  document.querySelector('#zoom-in').disabled = zoom === ZOOM_MAX;
}
function saveZoom(value) {
  setZoom(value);
  void chrome.storage.local.set({panelZoom:zoom});
}
setZoom(saved.panelZoom);
document.querySelector('#zoom-out').onclick = () => saveZoom(zoom - ZOOM_STEP);
document.querySelector('#zoom-in').onclick = () => saveZoom(zoom + ZOOM_STEP);
document.querySelector('#zoom-reset').onclick = () => saveZoom(ZOOM_DEFAULT);
