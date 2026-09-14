// Only this app frame can send requests; unrelated page content never receives bindings.
window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'alongside:request') { return; }
  const {id,binding,operation} = event.data;
  if (typeof id !== 'string' || typeof binding !== 'string') { return; }
  let result;
  try { result = await chrome.runtime.sendMessage({type:'page',binding,operation}); }
  catch (error) { result = {error:error.message}; }
  window.postMessage({channel:'alongside:response',id,...result},location.origin);
});
