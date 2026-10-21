/* Account API. Supports private Sheets through Apps Script or the local Node server. */
(() => {
    let user = null;
    let requestKey = null;
    let lastPayload = '';
    const byId = id => document.getElementById(id);
    const status = message => { byId('reseller-account-status').textContent = message; };
    async function api(path, data) {
        if (window.resellerSheets) {
            const result = await window.resellerSheets.request(path, data);
            if (!result?.ok) {
                if (result?.status === 401) {user=null;show();}
                throw Error(result?.error || 'No se pudo completar la operación.');
            }
            return result;
        }
        let response;
        try { response = await fetch('/api/' + path, { credentials:'same-origin', headers:{'Content-Type':'application/json'}, ...(data === undefined ? {} : {method:'POST',body:JSON.stringify(data)}) }); }
        catch { throw Error('No se pudo conectar. Revisá tu conexión e intentá nuevamente.'); }
        let result;
        try { result = await response.json(); }
        catch { throw Error('El acceso individual todavía no está conectado. Contactá a Tester Rosario.'); }
        if (!response.ok) { if(response.status===401) {user=null;show();} throw Error(result.error || 'No se pudo completar la operación.'); }
        return result;
    }
    function show() {
        byId('reseller-register').hidden = true;
        wholesaleLogin.hidden = Boolean(user);
        wholesaleContent.hidden = !user;
        byId('reseller-account-panel').hidden = !user;
        byId('reseller-admin-panel').hidden = user?.role !== 'admin';
        byId('reseller-greeting').textContent = user ? `Hola, ${user.name}` : '';
    }
    async function loadOrders() {
        const {orders} = await api('orders');
        const list = byId('reseller-orders'); list.replaceChildren();
        if (!orders.length) {list.textContent='Todavía no hay pedidos registrados.';return;}
        for (const order of orders) {
            const card=document.createElement('article');card.className='reseller-order';
            const title=document.createElement('strong');title.textContent=`Pedido ${order.id.slice(0,8).toUpperCase()} · ${order.status}`;
            const details=document.createElement('p');details.textContent=`${new Date(order.created).toLocaleDateString('es-AR')} · ${order.customer.name}${order.reseller ? ' · Revendedor: '+order.reseller : ''} · ${formatPrice(order.total)} en productos por transferencia`;
            const items=document.createElement('p');items.textContent=order.items.map(item=>`${item.quantity} × ${item.name} · 100 ml · ${item.mode==='instant'?'Entrega inmediata':'Por encargue'}`).join(' / ');
            card.append(title,details,items);list.append(card);
        }
    }
    async function loadUsers() {
        const {users}=await api('users');
        byId('reseller-users').replaceChildren();
        for(const account of users) { const row=document.createElement('p');row.textContent=`${account.name} · ${account.email} · ${account.status || 'Activo'}`;byId('reseller-users').append(row); }
    }
    async function refresh() {
        try {
            const result=await api('me'); user=result.user;show();
            // An account change must never carry another reseller's draft.
            const key='testerRosarioResellerCart:'+user.id;
            wholesaleCart=readStoredArray(key,[],true).filter(item=>item.size==='100ML');
            renderWholesaleCart();
            renderWholesaleProducts();
            await loadOrders();
            if(user.role==='admin') await loadUsers();
            loadWholesaleSheet().catch(()=>status('No se pudo actualizar el stock por encargue. Intentá nuevamente.'));
            status('');
        } catch(error) {if(user)status(error.message);}
    }
    window.resellerAccount = {
        get user(){return user;},
        async open(){show();await refresh();},
        async login(){
            const button=wholesaleLogin.querySelector('[type=submit]');button.disabled=true;
            byId('reseller-login-error').textContent='';
            try {const result=await api('login',{email:byId('reseller-email').value,password:wholesaleCode.value});user=result.user;wholesaleCode.value='';await refresh();}
            catch(error){byId('reseller-login-error').textContent=error.message;}
            finally{button.disabled=false;}
        },
        async checkout(){
            if(!user){show();return;}
            if(!wholesaleCart.length){status('Agregá una fragancia al pedido.');return;}
            const form=byId('reseller-customer-form');if(!form.reportValidity())return;
            const customer={};
            for(const field of ['name','lastName','dni','email','phone','street','streetNumber','floor','apartment','city','postalCode'])customer[field]=byId('reseller-customer-'+field).value.trim();
            customer.dni=customer.dni.replace(/[.\s]/g,'');customer.postalCode=customer.postalCode.replace(/\s/g,'').toUpperCase();
            if(!/^\d{7,9}$/.test(customer.dni)){status('Revisá el DNI del comprador.');return;}
            if(!/^(?:\d{4}|[A-Z]\d{4}[A-Z]{3})$/.test(customer.postalCode)){status('Revisá el código postal del comprador.');return;}
            const payload={customer,items:wholesaleCart.map(item=>({name:item.name,size:'100ML',mode:item.mode||'order',quantity:item.quantity}))};
            const signature=JSON.stringify(payload);if(signature!==lastPayload){requestKey=crypto.randomUUID();lastPayload=signature;}
            const button=wholesaleCheckout;button.disabled=true;status('Registrando pedido…');
            try {
                const {order}=await api('orders',{...payload,requestKey});
                const message=`Hola Tester Rosario, registré el pedido ${order.id.slice(0,8).toUpperCase()}.\nRevendedor: ${user.name} (${user.email})\nComprador: ${payload.customer.name} · ${payload.customer.phone}\n${payload.items.map(item=>`- ${item.quantity} x ${item.name} (100 ml, ${item.mode==='instant'?'entrega inmediata':'por encargue'})`).join('\n')}\nProductos por transferencia: ${formatPrice(order.total)}\nPendiente de confirmar stock, pago y envío.`;
                const link=byId('reseller-send-saved');link.href=`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;link.hidden=false;
                wholesaleCart=[];renderWholesaleCart();form.reset();requestKey=null;lastPayload='';
                status(`Pedido ${order.id.slice(0,8).toUpperCase()} registrado. Podés enviarlo por WhatsApp.`);
                await loadOrders();
            } catch(error){status(error.message);}
            finally{button.disabled=false;}
        }
    };
    byId('reseller-logout').addEventListener('click',async()=>{
        try{await api('logout',{});user=null;wholesaleCart=[];requestKey=null;lastPayload='';byId('reseller-orders').replaceChildren();byId('reseller-users').replaceChildren();byId('reseller-send-saved').hidden=true;byId('reseller-customer-form').reset();show();renderWholesaleCart();}
        catch(error){status(error.message);}
    });
    byId('reseller-refresh-orders').addEventListener('click',()=>loadOrders().catch(error=>status(error.message)));
    byId('reseller-create-user').addEventListener('submit',async event=>{
        event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');button.disabled=true;
        try {await api('users',{name:form.elements.name.value,email:form.elements.email.value,password:form.elements.password.value});form.reset();await loadUsers();status('Cuenta creada. Ya puede ingresar con su email y contraseña.');}
        catch(error){status(error.message);}finally{button.disabled=false;}
    });
    const registration = byId('reseller-register');
    const registrationStatus = byId('reseller-register-status');
    byId('reseller-show-register').addEventListener('click',()=>{
        wholesaleLogin.hidden=true;registration.hidden=false;
        registration.elements.firstName.focus();
    });
    byId('reseller-back-login').addEventListener('click',()=>{
        registration.hidden=true;wholesaleLogin.hidden=false;byId('reseller-email').focus();
    });
    registration.addEventListener('submit',async event=>{
        event.preventDefault();registrationStatus.textContent='';
        const fields=registration.elements,button=registration.querySelector('[type=submit]');
        if(fields.password.value!==fields.confirmPassword.value){registrationStatus.textContent='Las contraseñas no coinciden.';fields.confirmPassword.focus();return;}
        const dni=fields.dni.value.replace(/[.\s]/g,'');
        const postalCode=fields.postalCode.value.replace(/\s/g,'').toUpperCase();
        if(!/^\d{7,9}$/.test(dni)){registrationStatus.textContent='Ingresá un DNI válido, de 7 a 9 dígitos.';fields.dni.focus();return;}
        if(!/^(?:\d{4}|[A-Z]\d{4}[A-Z]{3})$/.test(postalCode)){registrationStatus.textContent='Ingresá un código postal de 4 dígitos o un CPA válido.';fields.postalCode.focus();return;}
        if(!window.resellerSheets){registrationStatus.textContent='El registro todavía no está conectado a la hoja. Contactá a Tester Rosario.';return;}
        const data={};
        for(const name of ['firstName','lastName','email','street','streetNumber','floor','apartment','city'])data[name]=fields[name].value.trim();
        Object.assign(data,{dni,postalCode,password:fields.password.value});
        button.disabled=true;registrationStatus.textContent='Creando tu cuenta…';
        try {
            const result=await api('register',data);
            byId('reseller-email').value=data.email;registration.reset();
            user=result.user;
            await refresh();
            status(result.message || 'Tu cuenta ya está activa. ¡Bienvenido a Tester Rosario!');
        }catch(error){registrationStatus.textContent=error.message;}
        finally{button.disabled=false;}
    });
    refresh();
})();
