(function () {
  var btn = document.querySelector('.menu-btn');
  var nav = document.getElementById('nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  }
  var form = document.getElementById('contact-form');
  if (!form) return;
  var status = document.getElementById('form-status');
  var q = new URLSearchParams(location.search);
  if (q.get('topic') && form.topic) form.topic.value = q.get('topic');
  if (q.get('sent')) { status.textContent = 'Thank you. Your message was sent.'; status.className = 'status ok'; }
  if (q.get('error')) { status.textContent = 'Please check the form and try again.'; status.className = 'status err'; }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    status.className = 'status'; status.textContent = 'Sending...';
    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { form.reset(); status.textContent = 'Thank you. Your message was sent.'; status.className = 'status ok'; }
      else { status.textContent = 'Please check the form and try again.'; status.className = 'status err'; }
    }).catch(function () { status.textContent = 'Something went wrong. Please try again later.'; status.className = 'status err'; });
  });
})();
