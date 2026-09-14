// Self-contained: Chrome serializes this function into the selected page.
export async function snapshotPage() {
  const TEXT_LIMIT = 16000, SEGMENT_LIMIT = 2000, FILE_LIMIT = 30;
  const TRANSCRIPT_CHARS = 50000, DIFF_CHARS = 40000;
  const CONTEXT_BEFORE = 45, CONTEXT_AFTER = 30;
  const text = element => (element?.innerText ?? element?.textContent ?? '').trim();
  const clip = (value,limit=TEXT_LIMIT) => value.slice(0,limit);
  const selection = clip(window.getSelection()?.toString() ?? '',4000);
  const result = {url:location.href,title:document.title,selection,capturedAt:new Date().toISOString(),kind:'page',text:clip(text(document.querySelector('main,article') ?? document.body)),truncated:false};
  result.truncated = text(document.querySelector('main,article') ?? document.body).length > TEXT_LIMIT;
  if ((location.hostname === 'youtube.com' || location.hostname.endsWith('.youtube.com')) && location.pathname === '/watch') {
    result.kind = 'youtube';
    const video = document.querySelector('video');
    const rows = [...document.querySelectorAll('ytd-transcript-segment-renderer')];
    const seconds = value => value.trim().split(':').reduce((total,part)=>total*60+Number(part),0);
    let segments = rows.map(row=>({start:seconds(text(row.querySelector('.segment-timestamp'))),text:text(row.querySelector('.segment-text'))})).filter(row=>Number.isFinite(row.start)&&row.text);
    let source = segments.length ? 'transcript-panel' : 'unavailable';
    if (!segments.length && video) {
      const track = [...video.textTracks].find(track=>track.cues?.length);
      if (track) { segments = [...track.cues].map(cue=>({start:cue.startTime,end:cue.endTime,text:cue.text})); source='text-track'; }
    }
    // Caption retrieval is best-effort; YouTube may require a displayed transcript.
    if (!segments.length) {
      try {
        const player = document.querySelector('#movie_player');
        const data = player?.getPlayerResponse?.() ?? window.ytInitialPlayerResponse;
        const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
        const track = tracks.find(track=>track.languageCode==='en') ?? tracks[0];
        if (track) {
          const url = new URL(track.baseUrl);
          if ((url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com'))) {
            url.searchParams.set('fmt','json3');
            const response = await fetch(url,{signal:AbortSignal.timeout(5000)});
            const captions = await response.json();
            segments = (captions.events??[]).filter(event=>event.segs).map(event=>({start:event.tStartMs/1000,end:(event.tStartMs+event.dDurationMs)/1000,text:event.segs.map(part=>part.utf8).join('').trim()})).filter(row=>row.text);
            if (segments.length) { source='caption-track'; }
          }
        }
      } catch { /* Empty or restricted caption responses are reported explicitly. */ }
    }
    const currentTime = video?.currentTime ?? null;
    const nearby = segments.filter(row=>currentTime!==null&&row.start>=currentTime-CONTEXT_BEFORE&&row.start<=currentTime+CONTEXT_AFTER);
    if (segments.length > SEGMENT_LIMIT) { result.truncated=true; }
    let remaining = TRANSCRIPT_CHARS;
    segments = segments.slice(0,SEGMENT_LIMIT).filter(row=>{ remaining-=JSON.stringify(row).length; return remaining>=0; });
    if (remaining<0) { result.truncated=true; }
    result.video = {id:new URL(location.href).searchParams.get('v'),currentTime,duration:Number.isFinite(video?.duration)?video.duration:null,paused:video?.paused??null,transcript:segments,transcriptSource:source,nearby,notice:source==='unavailable'?'Transcript unavailable. Open YouTube’s Show transcript panel, then refresh context.':null};
  }
  const pr = location.hostname==='github.com' && location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (pr) {
    result.kind = 'github-pr';
    const paths = new Map();
    for (const header of document.querySelectorAll('[data-path],[data-file-path]')) {
      const path = header.getAttribute('data-path') ?? header.getAttribute('data-file-path');
      const container = header.closest('.file,[data-testid="diff-file"],[data-file-path]') ?? header;
      if (path && (container.querySelector('.blob-code,[data-code-marker]') || container.matches('[data-testid="diff-file"]'))) { paths.set(path,container); }
    }
    const files = [...paths].map(([path,node])=>({path,node}));
    let diffRemaining = DIFF_CHARS;
    result.pullRequest = {repository:`${pr[1]}/${pr[2]}`,number:Number(pr[3]),heading:text(document.querySelector('.js-issue-title,[data-testid="issue-title"]')),description:clip(text(document.querySelector('.comment-body'))),files:files.slice(0,FILE_LIMIT).map(({path,node})=>{const lines=[...node.querySelectorAll('.blob-code,[data-code-marker]')].map(line=>{const marker=line.getAttribute('data-code-marker')??(line.classList.contains('blob-code-addition')?'+':line.classList.contains('blob-code-deletion')?'-':' ');return marker+text(line);});const diff=clip(lines.length?lines.join('\n'):text(node),Math.max(0,Math.min(12000,diffRemaining)));diffRemaining-=diff.length;return {path,diff};}).filter(file=>file.diff),notice:'Only loaded page content is included; collapsed, virtualized or other PR tabs may be missing.'};
  }
  return result;
}
