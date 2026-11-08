'use strict';
function normalize(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/\s*[[({]\s*(?:explicit|clean)(?:\s+version)?\s*[\])}]\s*/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function sameRecording(a,b){
 if(!normalize(a.title)||!normalize(a.artist)||normalize(a.title)!==normalize(b.title)||normalize(a.artist)!==normalize(b.artist))return false;
 const left=Number(a.duration),right=Number(b.duration);
 return !(left>0&&right>0)||Math.abs(left-right)<=Math.max(4,Math.min(left,right)*.03);
}
function preferExplicit(tracks,extra=[]){
 const seen=new Set();const result=[];
 for(const track of tracks){if(seen.has(track.id))continue;seen.add(track.id);result.push(track);}
 // Extras are candidates, never replacements for a selected ID or a different song.
 for(const track of extra){if(!track.isExplicit||seen.has(track.id))continue;const index=result.findIndex(item=>sameRecording(item,track));if(index<0)continue;result.splice(index,0,track);seen.add(track.id);}
 const groups=[];
 result.forEach((track,index)=>{let group=groups.find(g=>sameRecording(g.track,track));if(!group){group={track,indexes:[]};groups.push(group);}group.indexes.push(index);});
 for(const group of groups){const ordered=group.indexes.map(i=>result[i]).sort((a,b)=>Number(!!b.isExplicit)-Number(!!a.isExplicit));group.indexes.forEach((index,i)=>{result[index]=ordered[i];});}
 return result;
}
module.exports={preferExplicit,sameRecording};
