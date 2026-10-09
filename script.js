(function(){
var d=document,p=location.pathname.split("/").pop()||"index.html";
var L=[["index.html","Home"],["catalogue.html","Catalogue"],["faq.html","FAQ"]];
var h=d.getElementById("site-header");
if(h){h.innerHTML='<div class="wrap nav"><a class="brand" href="index.html">Mintrage Commerce</a><button class="burger" aria-label="Open menu" aria-expanded="false" aria-controls="menu"><span></span></button><nav id="menu" aria-label="Main">'+
L.map(function(x){return '<a href="'+x[0]+'"'+(x[0]==p?' aria-current="page"':'')+'>'+x[1]+'</a>'}).join("")+
'<a class="btn btn-p" href="register.html">Register Now</a></nav></div>';
var b=h.querySelector(".burger"),m=d.getElementById("menu");
b.addEventListener("click",function(){var o=m.classList.toggle("open");b.setAttribute("aria-expanded",o)});}
var f=d.getElementById("site-footer");
if(f){f.innerHTML='<div class="wrap"><div class="fg"><div><div class="fbrand">Mintrage Commerce</div><p>A digital production and fulfillment platform for independent sellers.</p></div>'+
'<div><h3>Navigate</h3><ul><li><a href="index.html">Home</a></li><li><a href="catalogue.html">Catalogue</a></li><li><a href="faq.html">FAQ</a></li><li><a href="register.html">Register</a></li></ul></div>'+
'<div><h3>Legal</h3><ul><li><a href="policies.html#privacy">Privacy Policy</a></li><li><a href="policies.html#refund">Refund/Cancellation Policy</a></li><li><a href="policies.html#agreement">Seller Agreement</a></li></ul></div>'+
'<div><h3>Contact</h3><ul><li><a href="mailto:mintrage.commerce@gmail.com">mintrage.commerce@gmail.com</a></li><li><a href="https://www.facebook.com/share/19cLqed9pv/?mibextid=wwXIfr" target="_blank" rel="noopener">Facebook</a></li><li><a href="https://www.instagram.com/mintragecommerce?cplk=Y3U3dno4bnAwOHUy&amp;utm_source=qr" target="_blank" rel="noopener">Instagram</a></li><li><a href="https://www.linkedin.com/company/mintrage-commerce/" target="_blank" rel="noopener">LinkedIn</a></li></ul></div></div>'+
'<div class="copy"><p class="small"><strong>Privacy:</strong> We collect and store the information you provided during registration and post registration period to facilitate our service seamlessly. <strong>Refunds:</strong> Registration fee is non-refundable. Base prices are refundable if an order is cancelled within 24 hours of ordering. <a href="policies.html">Full policies</a></p>© 2026 Mintrage Commerce. All rights reserved.</div></div>';}
if("IntersectionObserver" in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}})},{threshold:.1});d.querySelectorAll(".rv").forEach(function(el){io.observe(el)})}
else d.querySelectorAll(".rv").forEach(function(el){el.classList.add("in")});
var fm=d.getElementById("reg-form");
if(fm){fm.addEventListener("submit",function(ev){ev.preventDefault();
var msg=d.getElementById("msg"),btn=fm.querySelector("button"),url=window.MINTRAGE_REGISTRATION_ENDPOINT;
function show(c,t){msg.className=c;msg.textContent=t}
if(!fm.checkValidity()){fm.reportValidity();return}
if(!url){show("err","Registration is not switched on yet. Please email mintrage.commerce@gmail.com to register.");return}
btn.disabled=true;btn.textContent="Submitting…";
fetch(url,{method:"POST",mode:"no-cors",body:new URLSearchParams(new FormData(fm))}).then(function(){
fm.reset();fm.style.display="none";var s=d.getElementById("done");s.hidden=false;s.scrollIntoView({behavior:"smooth",block:"center"});
}).catch(function(){btn.disabled=false;btn.textContent="Submit Registration";show("err","Submission failed. Check your connection and try again, or email mintrage.commerce@gmail.com.")});
})}
})();
