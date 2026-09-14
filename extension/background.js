import { HOSTED_ORIGIN, isAppOrigin } from './origins.js';
import {snapshotPage} from './snapshot.js';
const PROTOCOL = '1.3', MAX_OUTPUT = 120000, MAX_CODE = 16000;
const DEFAULT_ORIGIN = HOSTED_ORIGIN;
chrome.action.onClicked.addListener(async tab => {
  // Open synchronously within Chrome's toolbar gesture, then bind that exact tab.
  const opened = chrome.sidePanel.open({tabId:tab.id});
  const key = `selection:${tab.windowId}`;
  try {
    const saved = await chrome.storage.local.get('origin');
    const selection = await bind(tab.id,saved.origin ?? DEFAULT_ORIGIN);
    await chrome.storage.session.set({[key]:{...selection,openId:crypto.randomUUID()}});
    await opened;
  } catch (error) {
    await opened.catch(()=>{});
    await chrome.storage.session.set({[key]:{error:error.message}});
  }
});
async function bind(tabId,origin) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url) || isAppOrigin(tab.url)) { throw Error('Choose a source website, not the Alongside board.'); }
  if (!isAppOrigin(origin)) { throw Error('Choose the Alongside app address'); }
  const sourceKey = `source:${tabId}`;
  const previous = (await chrome.storage.session.get(sourceKey))[sourceKey];
  const record = previous && (await chrome.storage.session.get(previous))[previous];
  if (record?.url === tab.url && record.origin === origin) { return {binding:previous,title:tab.title,tabId,origin}; }
  const binding = crypto.randomUUID();
  await chrome.storage.session.set({[binding]:{tabId,url:tab.url,origin},[sourceKey]:binding});
  return {binding,title:tab.title,tabId,origin};
}
async function readPage(binding,operation,sender) {
  const record = (await chrome.storage.session.get(binding))[binding];
  if (!record || new URL(sender.url).origin!==record.origin) { throw Error('Page connection expired. Reconnect from the extension.'); }
  const lessonId = new URL(sender.url).searchParams.get('lesson');
  if (lessonId && /^[a-f0-9-]{36}$/.test(lessonId)) { record.lessonId=lessonId;await chrome.storage.session.set({[binding]:record}); }
  const tab = await chrome.tabs.get(record.tabId);
  if (tab.url!==record.url) { throw Error('Source page navigated. Click the Alongside toolbar icon on the source page again.'); }
  let value;
  if (operation?.type==='snapshot') {
    const results = await chrome.scripting.executeScript({target:{tabId:record.tabId},world:'MAIN',func:snapshotPage});
    value = results[0]?.result;
  } else if (operation?.type==='evaluate') {
    if (typeof operation.code!=='string'||operation.code.length>MAX_CODE) { throw Error('Invalid page expression'); }
    const target = {tabId:record.tabId};
    await chrome.debugger.attach(target,PROTOCOL);
    try {
      const result = await chrome.debugger.sendCommand(target,'Runtime.evaluate',{expression:operation.code,returnByValue:true,throwOnSideEffect:true,timeout:5000});
      if (result.exceptionDetails) { throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); }
      value = result.result?.value ?? null;
    } finally { await chrome.debugger.detach(target).catch(()=>{}); }
  } else { throw Error('Unknown page operation'); }
  if ((await chrome.tabs.get(record.tabId)).url!==record.url) { throw Error('Source navigated while reading. Refresh its connection.'); }
  if (JSON.stringify(value).length>MAX_OUTPUT) { throw Error('Page result is too large. Return a smaller selection.'); }
  return {value};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  const run = async()=>{
    if (message.type==='bind' && sender.url===chrome.runtime.getURL('panel.html')) { return bind(message.tabId,message.origin); }
    if (message.type==='board' && sender.url===chrome.runtime.getURL('panel.html')) { const record=(await chrome.storage.session.get(message.binding))[message.binding]; if(!record){throw Error('Connection expired');}return {url:`${record.origin}/?source=${message.binding}${record.lessonId?'&lesson='+record.lessonId:''}`}; }
    if (message.type==='page') { return readPage(message.binding,message.operation,sender); }
    throw Error('Unsupported extension request');
  };
  run().then(reply,error=>reply({error:error.message}));return true;
});
