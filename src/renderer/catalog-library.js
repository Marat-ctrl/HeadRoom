(function(root){
 'use strict';
 const keys={albums:'riff_saved_albums',artists:'riff_favorite_artists'};
 function valid(kind,item){return !!item&&typeof item.id==='string'&&(kind==='albums'?/^MPRE[\w-]+$/:/^UC[\w-]+$/).test(item.id)&&typeof(item.title||item.name)==='string';}
 function snapshot(kind,item,savedAt){
  const title=String(item.title||item.name||'').slice(0,500);
  const image=String(item.thumbnail||item.cover||'');
  return{id:item.id,title,name:title,artist:String(item.artist||'').slice(0,500),artistId:String(item.artistId||''),thumbnail:image.startsWith('https://')?image:'',cover:image.startsWith('https://')?image:'',year:String(item.year||''),isExplicit:!!item.isExplicit,type:kind==='albums'?'album':'artist',savedAt};
 }
 function create(storage){
  function raw(kind){if(!keys[kind])throw new Error('Invalid library category.');try{const value=JSON.parse(storage.getItem(keys[kind])||'[]');return Array.isArray(value)?value:[];}catch{return[];}}
  function list(kind){const seen=new Set();return raw(kind).filter(item=>{if(!valid(kind,item)||seen.has(item.id))return false;seen.add(item.id);return true;}).map(item=>snapshot(kind,item,Number(item.savedAt)||0)).sort((a,b)=>b.savedAt-a.savedAt);}
  function has(kind,id){return list(kind).some(item=>item.id===id);}
  function toggle(kind,item){if(!keys[kind]||!valid(kind,item))throw new Error('Invalid catalog item.');const current=raw(kind);const exists=current.some(value=>value?.id===item.id);const next=current.filter(value=>value?.id!==item.id);if(!exists)next.push(snapshot(kind,item,Date.now()));storage.setItem(keys[kind],JSON.stringify(next));return !exists;}
  return{list,has,toggle};
 }
 const api={create};if(typeof module==='object'&&module.exports)module.exports=api;else root.HeadRoomLibrary=api;
})(typeof window==='object'?window:globalThis);
