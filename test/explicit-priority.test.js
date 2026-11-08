const test=require('node:test');const assert=require('node:assert/strict');
const {preferExplicit}=require('../src/shared/explicit-priority');
const track=(id,title,explicit,duration=122,artist='Rio Da Yung Og')=>({id,title,artist,isExplicit:explicit,duration});
test('explicit version moves ahead of its clean counterpart, preserving unrelated results and source IDs',()=>{
 const clean=track('clean','Milwaukee Bucks',false),other=track('other','Another song',true),explicit=track('explicit','Milwaukee Bucks (Explicit)',true);
 const input=[clean,other,explicit];assert.deepEqual(preferExplicit(input).map(t=>t.id),['explicit','other','clean']);assert.equal(input[0],clean);
});
test('only an explicit result for the same artist, song and recording length is accepted from extra search',()=>{
 const normal=[track('clean','Milwaukee Bucks',false)];
 const extra=[track('wrong-song','New York Minute',true),track('wrong-artist','Milwaukee Bucks',true,122,'Someone else'),track('live','Milwaukee Bucks',true,230),track('right','Milwaukee Bucks',true,123)];
 assert.deepEqual(preferExplicit(normal,extra).map(t=>t.id),['right','clean']);
});
test('missing explicit versions stay unmarked and remixes are not treated as the same recording',()=>{
 const clean=track('clean','Milwaukee Bucks',false);assert.deepEqual(preferExplicit([clean],[track('remix','Milwaukee Bucks (Remix)',true)]),[clean]);assert.equal(clean.isExplicit,false);
});
