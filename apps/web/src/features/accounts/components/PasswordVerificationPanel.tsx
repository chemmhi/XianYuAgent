import {useEffect,useRef,useState} from 'react';
import type {AccountsApi,PasswordLoginSessionVM} from '../api';
import {nativeCandidateMessage} from '../../verification/native-message';

/** The official CAPTCHA remains cross-origin; face QR/status comes from the server-owned IV session. */
export function PasswordVerificationPanel({api,session}:{api:AccountsApi;session:PasswordLoginSessionVM}){
  const frame=useRef<HTMLIFrameElement>(null),busy=useRef(false),[error,setError]=useState(''),[height,setHeight]=useState(640),[checking,setChecking]=useState(false);
  const surface=useRef<HTMLDivElement>(null),[scale,setScale]=useState(1);
  const challenge=session.verificationChallenge;
  useEffect(()=>{
    const element=surface.current;if(!element)return;
    const fit=()=>setScale(Math.max(0,Math.min(1,element.clientWidth/420,element.clientHeight/height)));
    const observer=new ResizeObserver(fit);observer.observe(element);fit();return()=>observer.disconnect();
  },[height,challenge?.id]);
  useEffect(()=>{
    if(!challenge)return;let live=true;busy.current=false;setChecking(false);setError('');setHeight(360);
    const receive=(event:MessageEvent)=>{
      if(!live||busy.current||!frame.current?.isConnected||Date.parse(session.expiresAt)<=Date.now())return;
      const sameSource=event.source===frame.current.contentWindow;
      if(sameSource&&event.origin===challenge.origin&&typeof event.data==='string'&&event.data.length<2000){
        try{const message=JSON.parse(event.data);if(message.action==='resizeIframe'&&Number.isFinite(message.height))setHeight(Math.max(280,Math.min(680,Number(message.height))));}catch{/* SDK progress is optional. */}
      }
      const candidate=nativeCandidateMessage(event.data,event.origin,challenge.origin,sameSource);
      if(!candidate||!api.submitPasswordVerification)return;
      busy.current=true;setChecking(true);setError('');
      void api.submitPasswordVerification(session.id,{challengeId:challenge.id,candidate}).catch(()=>{if(live){busy.current=false;setChecking(false);setError('验证结果交接失败，请重新完成官方验证。');}});
    };
    window.addEventListener('message',receive);return()=>{live=false;window.removeEventListener('message',receive);};
  },[api,session.id,session.expiresAt,challenge?.id]);
  if(session.verificationQr)return <section className="password-verification-qr" aria-label="闲鱼官方扫码人脸验证">
    <h3>拍摄脸部</h3><p>请用手机版闲鱼扫描二维码，按照官方提示完成人脸识别。</p>
    <img src={session.verificationQr.imageDataUrl} alt="闲鱼官方人脸验证二维码" width="240" height="240" />
    <p role="status">{session.verificationQr.status==='waiting'?'等待扫码验证':session.verificationQr.status==='verifying'?'正在进行人脸验证':session.verificationQr.status==='auditing'?'官方正在审核验证结果':'验证未通过，请按官方提示重试'}</p>
    <small>完成后会自动继续登录，请保持此窗口打开。</small>
  </section>;
  if(!challenge)return <p role="status">闲鱼要求安全验证，本次登录已暂停。</p>;
  return <section className="verification-panel" aria-label="闲鱼官方安全验证">
    <p role="status">请按闲鱼官方提示完成扫码、人脸识别或安全验证，验证后将继续登录。</p>
    <div ref={surface} className="password-verification-frame-stage" style={{height:`min(${height}px, calc(100dvh - 240px))`}}>
      <iframe key={challenge.id} ref={frame} src={challenge.url} title="闲鱼官方安全验证" width="420" height={height}
        className="password-official-verification-frame" style={{height,transform:`translate(-50%, -50%) scale(${scale})`}} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="strict-origin-when-cross-origin" />
    </div>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
