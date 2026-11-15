/* GPU-rendered, world-coordinate particle trails through a real vector field.
   Particle seeds are visual samples; vectors always come from FieldGrid.
   Time is accelerated and zoom-scaled for legibility, not a forecast trajectory. */
const WindParticles = (() => {
  const TRAIL=16, MAX=2400, RAD=Math.PI/180;
  const mercX=lon=>(lon+180)/360;
  const mercY=lat=>(1-Math.asinh(Math.tan(Math.max(-85,Math.min(85,lat))*RAD))/Math.PI)/2;
  function create() {
    let map,gl,buffer,vao,field=null,enabled=false,last=0,recordClock=0,head=0;
    let count=MAX,slow=0,cheap=0,frameStart=0,frames=0,costSum=0;
    const programs=new Map(),vertices=new Float32Array(MAX*TRAIL*8);
    const lon=new Float64Array(MAX),lat=new Float64Array(MAX),life=new Float32Array(MAX),speed=new Float32Array(MAX);
    const hx=new Float32Array(MAX*TRAIL),hy=new Float32Array(MAX*TRAIL);
    let lastView=null;
    function seed(i) {
      const center=map.getCenter(),span=Math.min(300,360*map.getCanvas().clientWidth/(512*2**map.getZoom()))*1.25;
      for(let tries=0;tries<40;tries++) {
        const x=FieldGrid.wrap(center.lng+(Math.random()-.5)*span),y=Math.max(-82.3,Math.min(82.3,center.lat+(Math.random()-.5)*Math.min(150,span*.8)));
        const v=field?.sample(y,x);if(!v)continue;
        lon[i]=x;lat[i]=y;life[i]=Math.random()*7+3;speed[i]=v.speed;
        for(let k=0;k<TRAIL;k++){hx[i*TRAIL+k]=mercX(x);hy[i*TRAIL+k]=mercY(y);}
        if(matchMedia('(prefers-reduced-motion: reduce)').matches){
          let px=x,py=y;
          const stepSeconds=-.12*36000/2**Math.max(0,map.getZoom()-2);
          for(let k=1;k<TRAIL;k++){
            const w=field.sample(py,px);if(!w)break;
            const next=FieldGrid.advect(py,px,w.u,w.v,stepSeconds);if(Math.abs(next.lon-px)>180||Math.abs(next.lat)>82.3)break;
            px=next.lon;py=next.lat;const h=i*TRAIL+(TRAIL-k)%TRAIL;hx[h]=mercX(px);hy[h]=mercY(py);
          }
        }
        return true;
      }
      life[i]=0;return false;
    }
    function reset(){head=0;for(let i=0;i<count;i++)seed(i);last=0;recordClock=0;}
    function compile(type,source) {
      const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error(message);}return shader;
    }
    function program(shaderData) {
      if(programs.has(shaderData.variantName))return programs.get(shaderData.variantName);
      const vertex=compile(gl.VERTEX_SHADER,`#version 300 es
precision highp float;
${shaderData.vertexShaderPrelude}
${shaderData.define}
in vec4 a_particle;
out mediump float v_alpha;
out mediump float v_speed;
void main(){gl_Position=projectTile(a_particle.xy);v_alpha=a_particle.z;v_speed=a_particle.w;}`);
      const fragment=compile(gl.FRAGMENT_SHADER,`#version 300 es
precision mediump float;
in float v_alpha;
in float v_speed;
out vec4 result;
void main(){float t=clamp(v_speed/25.0,0.0,1.0);vec3 c=mix(vec3(.45,.9,.86),vec3(.8,.88,1.),smoothstep(0.,.55,t));c=mix(c,vec3(.86,.58,1.),smoothstep(.55,1.,t));float a=v_alpha*.82;result=vec4(c*a,a);}`);
      const p=gl.createProgram();gl.attachShader(p,vertex);gl.attachShader(p,fragment);gl.linkProgram(p);gl.deleteShader(vertex);gl.deleteShader(fragment);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
      const uniforms={};for(const name of ['u_projection_matrix','u_projection_fallback_matrix','u_projection_tile_mercator_coords','u_projection_clipping_plane','u_projection_transition'])uniforms[name]=gl.getUniformLocation(p,name);
      const result={p,uniforms,attribute:gl.getAttribLocation(p,'a_particle')};programs.set(shaderData.variantName,result);return result;
    }
    const wake=()=>{if(!document.hidden&&enabled){last=0;frameStart=performance.now();frames=0;costSum=0;map.triggerRepaint();}};
    const layer={
      id:'wind-particles',type:'custom',renderingMode:'2d',
      onAdd(m,g){map=m;gl=g;document.addEventListener('visibilitychange',wake);count=map.getCanvas().clientWidth<500?1000:MAX;buffer=gl.createBuffer();vao=gl.createVertexArray();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices.byteLength,gl.DYNAMIC_DRAW);},
      render(g,args){
        if(!enabled||!field||document.hidden)return;
        count=Math.min(count,map.getCanvas().clientWidth<500?1000:MAX);
        const begin=performance.now(),now=begin,dt=last?Math.min(.05,(now-last)/1000):0;last=now;
        const view=map.getCenter();
        if(!lastView || Math.abs(map.getZoom()-lastView.zoom)>.55 || Math.abs(FieldGrid.wrap(view.lng-lastView.lon))>45 || Math.abs(view.lat-lastView.lat)>35){reset();lastView={zoom:map.getZoom(),lon:view.lng,lat:view.lat};}
        const seconds=dt*36000/2**Math.max(0,map.getZoom()-2);
        recordClock+=dt;const record=recordClock>=.12;if(record){head=(head+1)%TRAIL;recordClock%=.12;}
        let offset=0;
        for(let i=0;i<count;i++) {
          let v=field.sample(lat[i],lon[i]);life[i]-=dt;
          if(!v||life[i]<=0){if(!seed(i))continue;v=field.sample(lat[i],lon[i]);}
          const next=FieldGrid.advect(lat[i],lon[i],v.u,v.v,seconds);
          if(Math.abs(next.lon-lon[i])>180||Math.abs(next.lat)>82.3){seed(i);continue;}
          lon[i]=next.lon;lat[i]=next.lat;speed[i]=v.speed;
          const x=mercX(lon[i]),y=mercY(lat[i]);
          if(record){hx[i*TRAIL+head]=x;hy[i*TRAIL+head]=y;}
          let px=x,py=y;
          const lifeFade=Math.min(1,life[i]/1.5);
          for(let j=0;j<TRAIL-1;j++){
            const k=i*TRAIL+(head-j+TRAIL)%TRAIL,qx=hx[k],qy=hy[k];
            if(Math.abs(px-qx)>.5){px=qx;py=qy;continue;}
            const a=(1-j/TRAIL)*lifeFade;
            vertices[offset++]=px;vertices[offset++]=py;vertices[offset++]=a;vertices[offset++]=speed[i];
            vertices[offset++]=qx;vertices[offset++]=qy;vertices[offset++]=a*.93;vertices[offset++]=speed[i];
            px=qx;py=qy;
          }
        }
        const info=program(args.shaderData),u=info.uniforms,d=args.defaultProjectionData;
        gl.useProgram(info.p);gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,vertices.subarray(0,offset));
        gl.enableVertexAttribArray(info.attribute);gl.vertexAttribPointer(info.attribute,4,gl.FLOAT,false,16,0);
        gl.uniformMatrix4fv(u.u_projection_matrix,false,d.mainMatrix);
        gl.uniformMatrix4fv(u.u_projection_fallback_matrix,false,d.fallbackMatrix);
        gl.uniform4fv(u.u_projection_tile_mercator_coords,d.tileMercatorCoords);
        gl.uniform4fv(u.u_projection_clipping_plane,d.clippingPlane);
        gl.uniform1f(u.u_projection_transition,d.projectionTransition);
        gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.lineWidth(1);
        gl.drawArrays(gl.LINES,0,offset/4);gl.bindVertexArray(null);
        const cost=performance.now()-begin;costSum+=cost;frames++;
        if(cost>14){slow++;cheap=0;}else{slow=Math.max(0,slow-1);if(cost<5)cheap++;}
        if(slow>12 && count>800){count=Math.max(800,Math.floor(count*.8));slow=0;}
        if(cheap>240 && count<MAX && map.getCanvas().clientWidth>=500){const before=count;count=Math.min(MAX,count+160);for(let i=before;i<count;i++)seed(i);cheap=0;}
        if(now-frameStart>1500){const c=map.getCanvas();c.dataset.windParticles=String(count);c.dataset.windFrameMs=(costSum/frames).toFixed(2);c.dataset.windFps=(frames*1000/(now-frameStart)).toFixed(1);frames=0;costSum=0;frameStart=now;}
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches)map.triggerRepaint();
      },
      onRemove(){document.removeEventListener('visibilitychange',wake);if(gl){gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);for(const p of programs.values())gl.deleteProgram(p.p);}programs.clear();},
      setField(value){field=value;enabled=!!value;if(map&&field){reset();frameStart=performance.now();map.triggerRepaint();}},
      stop(){enabled=false;last=0;},
      getCount:()=>count
    };
    return layer;
  }
  return {create};
})();
