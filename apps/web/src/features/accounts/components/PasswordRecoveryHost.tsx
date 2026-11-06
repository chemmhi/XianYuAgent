import { useEffect, useRef, useState } from 'react';
import type { AccountsApi, PasswordLoginSessionVM } from '../api';
import { PasswordLoginForm } from './PasswordLoginForm';

/** Discover creator-owned background verification without collecting the password again. */
export function PasswordRecoveryHost({api,paused,onChanged}:{api:AccountsApi;paused:boolean;onChanged():void}){
  const [session,setSession]=useState<PasswordLoginSessionVM|null>(null);
  const changed=useRef(onChanged);changed.current=onChanged;
  useEffect(()=>{
    if(paused||session||!api.getPendingPasswordSession)return;
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{const next=await api.getPendingPasswordSession!();if(stopped)return;if(next){setSession(next);return;}}
      catch(cause){if(stopped)return;const status=cause&&typeof cause==='object'&&'status' in cause?Number(cause.status):0;if(status===401||status===403)return;}
      if(!stopped)timer=setTimeout(()=>void poll(),5000);
    }
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[api,paused,session?.id]);
  if(paused||!session)return null;
  const finish=()=>{setSession(null);changed.current();};
  return <PasswordLoginForm key={session.id} api={api} initialSession={session} onClose={finish} onCompleted={finish}/>;
}
