/* Fit tutor pages and crowded same-hour room blocks without removing rows. */
function createPrintFitter() {
  const profiles=[
    {font:14,padding:1.6,gap:4},
    {font:13,padding:1.3,gap:3},
    {font:12,padding:1.1,gap:2.5},
    {font:11,padding:.9,gap:2},
    {font:10,padding:.7,gap:1.5}
  ];
  function fitScale(width,height,availableWidth,availableHeight) {
    if(![width,height,availableWidth,availableHeight].every(n=>Number.isFinite(n)&&n>0)) {
      throw new Error('The tutor page could not be measured. Reopen the preview and try again.');
    }
    return Math.min(1,Math.max(1,availableWidth-2)/width,Math.max(1,availableHeight-2)/height);
  }
  function fit(body,content) {
    content.style.transform='none';
    let scale=1,profile;
    for(profile of profiles) {
      content.style.setProperty('--tutor-name-size',profile.font+'pt');
      content.style.setProperty('--tutor-cell-padding',profile.padding+'mm');
      content.style.setProperty('--tutor-class-gap',profile.gap+'mm');
      const bounds=content.getBoundingClientRect();
      scale=fitScale(Math.max(bounds.width,content.scrollWidth),Math.max(bounds.height,content.scrollHeight),body.clientWidth,body.clientHeight);
      if(scale===1)break;
    }
    content.style.transform=`scale(${scale})`;
    return {scale,font:profile.font,effectiveFont:profile.font*scale};
  }
  function fitRoom(body,content,maxFont,minFont=8) {
    if(![maxFont,minFont].every(n=>Number.isFinite(n)&&n>0)||minFont>maxFont)throw new Error('The room page could not be measured. Reopen the preview and try again.');
    content.style.transform='none';
    const setFont=font=>content.style.setProperty('--name-size',font+'pt');
    const measure=()=>{
      const bounds=content.getBoundingClientRect();
      return {width:Math.max(bounds.width,content.scrollWidth),height:Math.max(bounds.height,content.scrollHeight)};
    };
    const fits=()=>{const size=measure();return fitScale(size.width,size.height,body.clientWidth,body.clientHeight)===1;};
    setFont(maxFont);
    if(fits())return {font:maxFont,scale:1,effectiveFont:maxFont};
    setFont(minFont);
    if(!fits()) {
      const size=measure(),scale=fitScale(size.width,size.height,body.clientWidth,body.clientHeight);
      content.style.transform=`scale(${scale})`;
      return {font:minFont,scale,effectiveFont:minFont*scale};
    }
    let low=minFont,high=maxFont;
    for(let i=0;i<12&&high-low>.05;i++) {
      const mid=(low+high)/2;setFont(mid);
      if(fits())low=mid;else high=mid;
    }
    const font=Math.floor(low*10)/10;setFont(font);
    return {font,scale:1,effectiveFont:font};
  }
  return {fit,fitScale,fitRoom};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createPrintFitter};
