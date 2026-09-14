import {test,expect} from '@playwright/test';
test('long answers leave the board and composer visible',async({page})=>{
  await page.setViewportSize({width:620,height:900});
  await page.route('**/api/lessons/*',async route=>{
    const response=await route.fetch();
    const data=await response.json();
    if(data.document){data.answer='A detailed explanation. '.repeat(600);}
    await route.fulfill({response,json:data});
  });
  await page.goto('http://127.0.0.1:5176/?view=partner');
  const board=page.getByLabel('Shared explanation board');
  await expect(board).toBeVisible();
  await expect.poll(async()=> (await board.boundingBox())?.height??0).toBeGreaterThan(250);
  await expect(page.getByLabel('Question',{exact:true})).toBeInViewport();
  await page.screenshot({path:'output/panel-long-answer.png'});
});
