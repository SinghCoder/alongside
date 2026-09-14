import {test,expect} from '@playwright/test';
test('white labels have their fill during writing and completed drawings undo',async({page})=>{
  const scene=[{kind:'native',id:'dark',x:100,y:100,width:400,height:180,element:{type:'rectangle',backgroundColor:'#173d30',fillStyle:'solid',strokeColor:'#173d30',label:{text:'White words remain readable as we write together',strokeColor:'#ffffff',fontSize:22}}}];
  await page.route('**/api/partner',route=>route.fulfill({contentType:'application/x-ndjson',body:[{type:'hello',runId:'drawing-test'},{type:'present',id:1,before:[],shot:{scene,focus:'dark',caption:'Readable text',duration:400,speed:0.45}},{type:'done',answer:'Done.',skills:[]}].map(event=>JSON.stringify(event)+'\n').join('')}));
  await page.route('**/api/partner/ack',route=>route.fulfill({json:{ok:true}}));
  await page.goto('http://127.0.0.1:5176/');
  await expect(page.getByRole('button',{name:'Ask',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Ask',exact:true}).click();
  await expect(page.getByTestId('partner-lettering').first()).toContainText(/White/,{timeout:10000});
  await expect(page.getByTestId('partner-fill')).toHaveAttribute('fill','#173d30');
  await page.screenshot({path:'output/white-label-writing.png'});
  await expect(page.getByRole('button',{name:'Ask',exact:true})).toBeVisible({timeout:10000});
  const saved=()=>page.evaluate(async()=> (await fetch('/api/lessons/'+new URL(location.href).searchParams.get('lesson'))).json());
  expect((await saved()).document.snapshot.scene.length).toBe(1);
  await page.getByLabel('Shared explanation board').click({position:{x:20,y:100}});
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async()=> (await saved()).document.snapshot.scene.length).toBe(0);
});
