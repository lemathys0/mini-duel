let currentUser = null;
let enemyHP = 100;

function attack() {
  const damage = Math.floor(Math.random() * 20) + 5;
  enemyHP = Math.max(0, enemyHP - damage);
  document.getElementById('enemy-hp').value = enemyHP;
  document.getElementById('combat-result').textContent = `💥 Tu as infligé ${damage} dégâts !`;
  if (enemyHP === 0) {
    document.getElementById('combat-result').textContent = "🏆 Tu as vaincu le gobelin !";
  }
}

function defend() {
  document.getElementById('combat-result').textContent = "🛡️ Tu te défends, aucun dégât reçu.";
}

function signup() {
  const pseudo = document.getElementById('signup-pseudo').value.trim();
  const code = document.getElementById('signup-code').value.trim();
  const msg = document.getElementById('signup-msg');
  msg.textContent = '';

  if (!pseudo || !/^\d{4}$/.test(code)) {
    msg.textContent = 'Pseudo ou code invalide';
    return;
  }

  currentUser = { pseudo, code };
  document.getElementById('user-name').textContent = pseudo;
  document.getElementById('signup-section').style.display = 'none';
  document.getElementById('tab-content').style.display = 'block';
  document.getElementById('bottom-tabs').style.display = 'flex';
}

function login() {
  const pseudo = document.getElementById('login-pseudo').value.trim();
  const code = document.getElementById('login-code').value.trim();
  const msg = document.getElementById('login-msg');
  msg.textContent = '';

  if (!pseudo || !/^\d{4}$/.test(code)) {
    msg.textContent = 'Pseudo ou code invalide';
    return;
  }

  currentUser = { pseudo, code };
  document.getElementById('user-name').textContent = pseudo;
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('tab-content').style.display = 'block';
  document.getElementById('bottom-tabs').style.display = 'flex';
}

function showLogin() {
  document.getElementById('signup-section').style.display = 'none';
  document.getElementById('login-section').style.display = 'block';
  document.getElementById('tab-content').style.display = 'none';
}

function showSignup() {
  document.getElementById('signup-section').style.display = 'block';
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('tab-content').style.display = 'none';
}

function showTab(tab) {
  alert(`Onglet ${tab} (placeholder)`); // Pour les autres onglets à venir
}

// Au chargement initial
showSignup();
