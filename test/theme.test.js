const test=require('node:test');const assert=require('node:assert/strict');
test('HeadRoom always resolves dark, including saved light/system modes and a light OS',()=>{
 const theme=require('../src/renderer/theme');
 for(const mode of ['dark','light','system','auto','discord','',null,undefined])for(const systemDark of [true,false]){assert.equal(theme.normalizeMode(mode),'dark');assert.equal(theme.resolveMode(mode,systemDark),'dark');}
});
