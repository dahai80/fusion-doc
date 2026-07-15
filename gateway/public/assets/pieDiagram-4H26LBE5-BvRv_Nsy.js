import{Ln as e,R as t,Rn as n,Rt as r,Vn as i,gn as a,hn as o,j as s,nr as c,on as l,rn as u,rr as d,un as f,vn as p,wt as m,xn as h,xt as g,zt as _}from"./chunk-LZXEDZCA-4GiMzlKw.js";import{t as v}from"./ordinal-hYBb2elL.js";import{t as y}from"./arc-BA3mGBOa.js";import{t as b}from"./mermaid-parser.core-BO_rrmyP.js";import{t as x}from"./chunk-4BX2VUAB-bgQvSraM.js";function S(e,t){return t<e?-1:t>e?1:t>=e?0:NaN}function C(e){return e}function w(){var e=C,t=S,n=null,i=_(0),a=_(r),o=_(0);function s(s){var c,l=(s=m(s)).length,u,d,f=0,p=Array(l),h=Array(l),g=+i.apply(this,arguments),_=Math.min(r,Math.max(-r,a.apply(this,arguments)-g)),v,y=Math.min(Math.abs(_)/l,o.apply(this,arguments)),b=y*(_<0?-1:1),x;for(c=0;c<l;++c)(x=h[p[c]=c]=+e(s[c],c,s))>0&&(f+=x);for(t==null?n!=null&&p.sort(function(e,t){return n(s[e],s[t])}):p.sort(function(e,n){return t(h[e],h[n])}),c=0,d=f?(_-l*b)/f:0;c<l;++c,g=v)u=p[c],x=h[u],v=g+(x>0?x*d:0)+b,h[u]={data:s[u],index:c,value:x,startAngle:g,endAngle:v,padAngle:y};return h}return s.value=function(t){return arguments.length?(e=typeof t==`function`?t:_(+t),s):e},s.sortValues=function(e){return arguments.length?(t=e,n=null,s):t},s.sort=function(e){return arguments.length?(n=e,t=null,s):n},s.startAngle=function(e){return arguments.length?(i=typeof e==`function`?e:_(+e),s):i},s.endAngle=function(e){return arguments.length?(a=typeof e==`function`?e:_(+e),s):a},s.padAngle=function(e){return arguments.length?(o=typeof e==`function`?e:_(+e),s):o},s}var T=f.pie,E={sections:new Map,showData:!1,config:T},D=E.sections,O=E.showData,k=structuredClone(T),A={getConfig:c(()=>structuredClone(k),`getConfig`),clear:c(()=>{D=new Map,O=E.showData,u()},`clear`),setDiagramTitle:i,getDiagramTitle:h,setAccTitle:n,getAccTitle:a,setAccDescription:e,getAccDescription:o,addSection:c(({label:e,value:t})=>{if(t<0)throw Error(`"${e}" has invalid value: ${t}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);D.has(e)||(D.set(e,t),d.debug(`added new section: ${e}, with value: ${t}`))},`addSection`),getSections:c(()=>D,`getSections`),setShowData:c(e=>{O=e},`setShowData`),getShowData:c(()=>O,`getShowData`)},j=c((e,t)=>{x(e,t),t.setShowData(e.showData),e.sections.map(t.addSection)},`populateDb`),M={parse:c(async e=>{let t=await b(`pie`,e);d.debug(t),j(t,A)},`parse`)},N=c(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,`getStyles`),P=c(e=>{let t=[...e.values()].reduce((e,t)=>e+t,0),n=[...e.entries()].map(([e,t])=>({label:e,value:t})).filter(e=>e.value/t*100>=1);return w().value(e=>e.value).sort(null)(n)},`createPieArcs`),F={parser:M,db:A,renderer:{draw:c((e,n,r,i)=>{d.debug(`rendering pie chart
`+e);let a=i.db,o=p(),c=s(a.getConfig(),o.pie),u=g(n),f=u.append(`g`);f.attr(`transform`,`translate(225,225)`);let{themeVariables:m}=o,[h]=t(m.pieOuterStrokeWidth);h??=2;let _=c.textPosition,b=y().innerRadius(0).outerRadius(185),x=y().innerRadius(185*_).outerRadius(185*_);f.append(`circle`).attr(`cx`,0).attr(`cy`,0).attr(`r`,185+h/2).attr(`class`,`pieOuterCircle`);let S=a.getSections(),C=P(S),w=[m.pie1,m.pie2,m.pie3,m.pie4,m.pie5,m.pie6,m.pie7,m.pie8,m.pie9,m.pie10,m.pie11,m.pie12],T=0;S.forEach(e=>{T+=e});let E=C.filter(e=>(e.data.value/T*100).toFixed(0)!==`0`),D=v(w).domain([...S.keys()]);f.selectAll(`mySlices`).data(E).enter().append(`path`).attr(`d`,b).attr(`fill`,e=>D(e.data.label)).attr(`class`,`pieCircle`),f.selectAll(`mySlices`).data(E).enter().append(`text`).text(e=>(e.data.value/T*100).toFixed(0)+`%`).attr(`transform`,e=>`translate(`+x.centroid(e)+`)`).style(`text-anchor`,`middle`).attr(`class`,`slice`);let O=f.append(`text`).text(a.getDiagramTitle()).attr(`x`,0).attr(`y`,-400/2).attr(`class`,`pieTitleText`),k=[...S.entries()].map(([e,t])=>({label:e,value:t})),A=f.selectAll(`.legend`).data(k).enter().append(`g`).attr(`class`,`legend`).attr(`transform`,(e,t)=>{let n=22*k.length/2;return`translate(216,`+(t*22-n)+`)`});A.append(`rect`).attr(`width`,18).attr(`height`,18).style(`fill`,e=>D(e.label)).style(`stroke`,e=>D(e.label)),A.append(`text`).attr(`x`,22).attr(`y`,14).text(e=>a.getShowData()?`${e.label} [${e.value}]`:e.label);let j=512+Math.max(...A.selectAll(`text`).nodes().map(e=>e?.getBoundingClientRect().width??0)),M=O.node()?.getBoundingClientRect().width??0,N=450/2-M/2,F=450/2+M/2,I=Math.min(0,N),L=Math.max(j,F)-I;u.attr(`viewBox`,`${I} 0 ${L} 450`),l(u,450,L,c.useMaxWidth)},`draw`)},styles:N};export{F as diagram};