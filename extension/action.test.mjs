import test from 'node:test';
import assert from 'node:assert/strict';

test('toolbar click opens and selects its source without a second gesture', async () => {
  let click;
  const data={};
  const opened=[];
  const tab={id:42,windowId:7,url:'https://example.com/article',title:'Article'};
  globalThis.chrome={
    action:{onClicked:{addListener:fn=>{click=fn}}},
    sidePanel:{open:async options=>{opened.push(options)}},
    tabs:{get:async()=>tab},
    storage:{local:{get:async()=>({})},session:{get:async key=>({[key]:data[key]}),set:async values=>{Object.assign(data,values)}}},
    runtime:{onMessage:{addListener(){}},getURL:path=>'chrome-extension://test/'+path},
  };
  try {
    await import('./background.js');
    await click(tab);
    assert.deepEqual(opened,[{tabId:42}]);
    assert.equal(data['selection:7'].title,'Article');
    const binding=data['selection:7'].binding;
    const previousOpen=data['selection:7'].openId;
    data[binding].lessonId='12345678-1234-1234-1234-123456789012';
    await click(tab);
    assert.equal(data['selection:7'].binding,binding);
    assert.notEqual(data['selection:7'].openId,previousOpen);
    assert.equal(data[binding].lessonId,'12345678-1234-1234-1234-123456789012');
  } finally {delete globalThis.chrome;}
});
