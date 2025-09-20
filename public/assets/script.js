(function(){
  const nav = document.querySelector('.main-nav');
  const burger = document.querySelector('.burger');
  const menu = document.getElementById('primary-menu');

  if (burger && nav && menu) {
    burger.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(isOpen));
    });

    // Закрыть меню при клике по ссылке (моб.)
    menu.addEventListener('click', (e) => {
      if (e.target.tagName === 'A' && nav.classList.contains('open')) {
        nav.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Год в футере
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  // Плавный скролл для якорей
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({behavior:'smooth',block:'start'});
      history.pushState(null,'',`#${id}`);
    }
  });

  // Пре‑заполнение формы из query
  const params = new URLSearchParams(location.search);
  const prefill = () => {
    const form = document.getElementById('contactForm');
    if (!form) return;
    const classParam = params.get('class');
    const planParam = params.get('plan');
    const trainer = params.get('trainer');
    const intent = params.get('intent');
    const message = document.getElementById('message');

    let note = [];
    if (classParam) note.push(`Направление: ${classParam}`);
    if (planParam) note.push(`Тариф: ${planParam}`);
    if (trainer) note.push(`Тренер: ${trainer}`);
    if (intent) note.push(`Запрос: ${intent}`);
    if (message && note.length) message.value = note.join(' | ') + (message.value ? ` | ${message.value}` : '');
  };
  prefill();

  // Валидация и фейковая отправка формы
  const form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fields = {
        name: form.querySelector('#name'),
        phone: form.querySelector('#phone'),
        email: form.querySelector('#email'),
        goal: form.querySelector('#goal'),
        policy: form.querySelector('#policy')
      };
      let valid = true;

      Object.values(fields).forEach((el) => {
        if (!el) return;
        const err = el.closest('.form-field')?.querySelector('.error');
        if (err) err.textContent = '';
        el.classList.remove('invalid');
      });

      if (!fields.name.value.trim()) {
        setErr(fields.name, 'Укажите имя'); valid = false;
      }
      if (!/^\+?\d[\d\s\-\(\)]{8,}$/.test(fields.phone.value.trim())) {
        setErr(fields.phone, 'Укажите телефон в правильном формате'); valid = false;
      }
      if (fields.email.value && !/^\S+@\S+\.\S+$/.test(fields.email.value.trim())) {
        setErr(fields.email, 'Некорректный e‑mail'); valid = false;
      }
      if (!fields.goal.value) {
        setErr(fields.goal, 'Выберите цель'); valid = false;
      }
      if (!fields.policy.checked) {
        const err = fields.policy.closest('.form-field')?.querySelector('.error');
        if (err) err.textContent = 'Требуется согласие на обработку';
        valid = false;
      }

      const msg = form.querySelector('.form-message');
      if (!valid) {
        if (msg) { msg.textContent = 'Проверьте поля формы'; msg.style.color = '#dc2626'; }
        return;
      }
      // Имитация отправки
      setTimeout(() => {
        if (msg) {
          msg.textContent = 'Заявка отправлена! Мы свяжемся с вами в ближайшее время.';
          msg.style.color = '#059669';
        }
        form.reset();
      }, 500);

      function setErr(el, text){
        const err = el.closest('.form-field')?.querySelector('.error');
        if (err) err.textContent = text;
        el.classList.add('invalid');
      }
    });
  }
})();