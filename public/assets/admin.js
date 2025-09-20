document.addEventListener('DOMContentLoaded', () => {
  const loginView = document.getElementById('login-view');
  const dashboardView = document.getElementById('dashboard-view');
  const loginForm = document.getElementById('loginForm');
  const logoutBtn = document.getElementById('logoutBtn');

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/me');
      if (response.ok) {
        const user = await response.json();
        if (user.role === 'admin') {
          showDashboard();
          return;
        }
      }
      showLogin();
    } catch (error) {
      showLogin();
    }
  };

  const showLogin = () => {
    loginView.style.display = 'block';
    dashboardView.style.display = 'none';
  };

  const showDashboard = () => {
    loginView.style.display = 'none';
    dashboardView.style.display = 'block';
    loadDashboardData();
  };

  const loadDashboardData = async () => {
    try {
      // Fetch visits
      const visitsRes = await fetch('/api/visits');
      const visitsData = await visitsRes.json();
      document.getElementById('total-visits').textContent = visitsData.stats.totalVisits;
      document.getElementById('unique-visitors').textContent = visitsData.stats.uniqueVisitors;
      
      const visitsTable = document.getElementById('visits-table');
      visitsTable.innerHTML = '';
      visitsData.visits.forEach(visit => {
        const row = `<tr>
          <td>${visit.ip}</td>
          <td>${visit.path}</td>
          <td>${new Date(visit.created_at).toLocaleString()}</td>
          <td>${visit.user_agent.substring(0, 50)}...</td>
        </tr>`;
        visitsTable.innerHTML += row;
      });

      // Fetch submissions
      const subsRes = await fetch('/api/submissions');
      const subsData = await subsRes.json();
      document.getElementById('total-submissions').textContent = subsData.submissions.length;

      const subsTable = document.getElementById('submissions-table');
      subsTable.innerHTML = '';
      subsData.submissions.forEach(sub => {
        const row = `<tr>
          <td>${sub.name}</td>
          <td>${sub.phone}</td>
          <td>${sub.goal}</td>
          <td>${new Date(sub.created_at).toLocaleString()}</td>
        </tr>`;
        subsTable.innerHTML += row;
      });

    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
  };

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        checkAuth();
      } else {
        errorEl.textContent = 'Неверный email или пароль.';
      }
    } catch (error) {
      errorEl.textContent = 'Ошибка сервера.';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    checkAuth();
  });

  checkAuth();
});