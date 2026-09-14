import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotPage } from './snapshot.js';

test('late playback keeps nearby cues after transcript truncation', async () => {
  const currentTime = 6000;
  const rows = Array.from({length:1000},(_,index)=>({querySelector:selector=>({textContent:selector==='.segment-timestamp'?`${index}:00`:`Segment ${index} ${'word '.repeat(100)}`})}));
  globalThis.location = new URL('https://www.youtube.com/watch?v=test');
  globalThis.window = {getSelection:()=>null};
  globalThis.document = {title:'Long lecture',body:{textContent:''},querySelector:selector=>selector==='video'?{currentTime,duration:60000,paused:true}:null,querySelectorAll:()=>rows};
  try {
    const snapshot = await snapshotPage();
    assert.equal(snapshot.truncated,true);
    assert.ok(snapshot.video.nearby.some(cue=>cue.start===currentTime));
    assert.ok(snapshot.video.transcript.length<rows.length);
  } finally {
    delete globalThis.location;
    delete globalThis.window;
    delete globalThis.document;
  }
});
