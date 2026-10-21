/* Transport between GitHub Pages and the Apps Script HTML service. */
(() => {
    const scriptURL = window.TESTER_RESELLER_SCRIPT_URL;
    if (!scriptURL) return;
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(scriptURL)) {
        window.resellerSheets = {request:async()=>{throw Error('Revisá el enlace de Apps Script: debe terminar en /exec.');}};
        return;
    }
    const channel='tester-reseller-v1', nonce=crypto.randomUUID(), pending=new Map();
    let peer=null, peerOrigin='', readyResolve, readyReject;
    const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    ready.catch(()=>{});
    const timeout=setTimeout(()=>readyReject(Error('No se pudo conectar con la hoja. Revisá la implementación de Apps Script y recargá la página.')),45000);
    const frame=document.createElement('iframe');frame.hidden=true;frame.title='Conexión privada con la hoja de revendedores';
    window.addEventListener('message',event=>{
        const data=event.data;
        if(!data||data.channel!==channel)return;
        if(data.kind==='bridge-ready'&&data.nonce===nonce&&!peer&&/^https:\/\/(?:[a-z0-9-]+-script\.googleusercontent\.com|script\.google\.com)$/.test(event.origin)) {
            peer=event.source;peerOrigin=event.origin;
            peer.postMessage({channel,kind:'hello',nonce},peerOrigin);return;
        }
        if(event.source!==peer||event.origin!==peerOrigin)return;
        if(data.kind==='ready'&&data.nonce===nonce){clearTimeout(timeout);readyResolve();return;}
        if(data.kind==='response'&&pending.has(data.id)) {
            const item=pending.get(data.id);pending.delete(data.id);clearTimeout(item.timer);item.resolve(data.result);
        }
    });
    frame.src=scriptURL+'?bridgeNonce='+encodeURIComponent(nonce);document.body.append(frame);
    let session='';
    try{session=sessionStorage.getItem('testerResellerSession')||'';}catch{}
    function setSession(value){session=value;try{if(value)sessionStorage.setItem('testerResellerSession',value);else sessionStorage.removeItem('testerResellerSession');}catch{}}
    async function derive(email,password){
        const enc=new TextEncoder();
        const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
        const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode('TesterRosario:v1:'+email.trim().toLowerCase()),iterations:600000},key,256);
        return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
    }
    window.resellerSheets={async request(path,data){
        // Before the first sign-in there is no session to restore.
        if(path==='me'&&!session)return {ok:false,status:401,error:'Ingresá a tu cuenta para continuar.'};
        await ready;
        let payload=data;
        if(['login','users','register'].includes(path)&&data?.password!==undefined){
            if(data.password.length<10||data.password.length>200)throw Error('La contraseña debe tener entre 10 y 200 caracteres.');
            payload={...data,credential:await derive(data.email,data.password)};delete payload.password;
        }
        const id=crypto.randomUUID();
        const result=await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{pending.delete(id);reject(Error('La hoja tardó en responder. Podés reintentar sin duplicar el pedido.'));},45000);
            pending.set(id,{resolve,timer});
            peer.postMessage({channel,kind:'request',id,input:{path,method:data===undefined?'GET':'POST',data:payload,token:session}},peerOrigin);
        });
        if(result?.token){setSession(result.token);delete result.token;}
        if(path==='logout'&&result?.ok||result?.status===401)setSession('');
        return result;
    }};
})();
