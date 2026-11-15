/* Scalar interpolation and PNG encoding run off the interaction thread. */
importScripts('field-grid.js');
const fields=new Map(),jobs=new Map();
self.onmessage=async({data:m})=>{
  if(m.type==='field'){
    const field=FieldGrid.make(m.samples,m.mode.field,m.name==='wind',m.step);
    const colors=m.mode.colors.map(s=>s.slice(1).match(/../g).map(v=>parseInt(v,16)));
    const palette=new Uint8Array(256*3);
    for(let i=0;i<256;i++){const u=i/255*2,j=Math.min(1,Math.floor(u)),t=u-j;for(let c=0;c<3;c++)palette[i*3+c]=Math.round(colors[j][c]*(1-t)+colors[j+1][c]*t);}
    fields.set(m.revision,{field,palette,mode:m.mode});while(fields.size>3)fields.delete(fields.keys().next().value);
    self.postMessage({type:'ready',revision:m.revision});return;
  }
  if(m.type==='cancel'){const job=jobs.get(m.id);if(job)job.aborted=true;return;}
  if(m.type!=='tile')return;
  const job={aborted:false};jobs.set(m.id,job);
  try{
    const state=fields.get(m.revision);if(!state)throw Error('Field was superseded');
    const size=256,n=2**m.z,image=new ImageData(size,size),p=image.data;
    const longitudes=Float64Array.from({length:size},(_,i)=>(m.x+(i+.5)/size)/n*360-180);
    for(let y=0;y<size;y++){
      if(y%32===0){await new Promise(resolve=>setTimeout(resolve,0));if(job.aborted)return;}
      const lat=Math.atan(Math.sinh(Math.PI*(1-2*(m.y+(y+.5)/size)/n)))*180/Math.PI;
      for(let x=0;x<size;x++){
        const value=state.field.sample(lat,longitudes[x]);if(value===null)continue;
        const v=typeof value==='number'?value:value.speed;
        const t=Math.max(0,Math.min(255,Math.round((v-state.mode.min)/(state.mode.max-state.mode.min)*255))),i=(y*size+x)*4;
        p[i]=state.palette[t*3];p[i+1]=state.palette[t*3+1];p[i+2]=state.palette[t*3+2];
        p[i+3]=Math.round(255*Math.max(0,Math.min(1,(82.5-Math.abs(lat))/1.2)));
      }
    }
    const canvas=new OffscreenCanvas(size,size);canvas.getContext('2d').putImageData(image,0,0);
    const blob=await canvas.convertToBlob({type:'image/png'}),buffer=await blob.arrayBuffer();
    if(!job.aborted)self.postMessage({id:m.id,data:buffer},[buffer]);
  }catch(error){self.postMessage({id:m.id,error:error.message});}finally{jobs.delete(m.id);}
};
