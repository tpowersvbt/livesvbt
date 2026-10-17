document.querySelector('.nav-toggle').addEventListener('click', function () {
  var open = document.querySelector('nav.main').classList.toggle('open');
  this.setAttribute('aria-expanded', open);
});
document.getElementById('contact-form').addEventListener('submit', function (e) {
  e.preventDefault();
  document.getElementById('form-status').textContent =
    'Thank you. A relationship manager will contact you shortly. (Demo form: no data is transmitted.)';
  this.reset();
});
