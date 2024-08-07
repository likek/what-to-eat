const colors = [
  "#FF7F50", // 珊瑚橙
  "#48D1CC", // 海绿色
  "#98FB98", // 浅绿
  "#FFB6C1", // 浅粉红
  "#FFD700", // 金色
  "#8A2BE2", // 深紫罗兰
  "#00FFFF", // 青色
  "#DC143C", // 深红
  "#ADD8E6", // 淡蓝
  "#FF6347", // 番茄红
  "#FFA07A", // 橙黄
  "#87CEEB", // 天蓝
  "#FF4500", // 橙红
  "#6495ED", // 蓝宝石
  "#7FFFD4", // 水晶绿
  "#DB7093", // 桃红
  "#FF8C00", // 橙
  "#00CED1", // 深天蓝
  "#FA8072", // 沙漠红
  "#20B2AA", // 青绿
];
let currentVersion = null;
let currRestaurant = null;
var spining = false;

document.addEventListener("DOMContentLoaded", () => {
  fetchRestaurants().finally(() => {
    fetchHistory();
  });
  checkForUpdates();
});

function checkForUpdates() {
  fetch("/api/version")
    .then((response) => response.json())
    .then((data) => {
      const version = data.version;
      if (currentVersion && currentVersion !== version) {
        if (confirm("检测到更新，是否立即更新？")) {
          location.reload(true);
        }
      }
      currentVersion = version;
    });

  setTimeout(checkForUpdates, 60000); // 每分钟检查一次
}

function fetchRestaurants() {
  return fetch("/api/restaurants")
    .then((response) => response.json())
    .then((data) => {
      const restaurantList = document.getElementById("restaurant-list");
      restaurantList.innerHTML = data.data.length ? "" : "请添加饭店";
      data.data.forEach((restaurant) => {
        const div = document.createElement("div");
        div.className = "restaurant-item";
        div.innerHTML = `
            <span>${restaurant.name}</span>
          `;
        const delbtn = document.createElement("img");
        delbtn.className = "btn-del";
        delbtn.src = './assets/icon_del.png';
        delbtn.onclick = function () {
          deleteRestaurant(restaurant.id, restaurant.name);
        };
        div.appendChild(delbtn);
        const img = document.createElement("img");
        img.src = "./assets/icon_edit.png";
        img.style = "width:12px;height:12px;";
        img.onclick = function () {
          editRestaurant(restaurant.id, restaurant.name);
        };
        if (restaurant.id === currRestaurant?.restaurant_id) {
          div.classList.add("highlight");
        }
        div.appendChild(img);
        restaurantList.appendChild(div);
      });
    });
}

function addRestaurant() {
  const name = document.getElementById("restaurant-name").value;
  if (name.trim() === "") {
    showErrorMessage("请输入饭店名");
    return;
  }

  fetch("/api/restaurants", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.error) {
        showErrorMessage(data.error);
      } else {
        fetchRestaurants();
        document.getElementById("restaurant-name").value = "";
        showErrorMessage("");
      }
    });
}

function deleteRestaurant(id, name) {
  const flag = window.confirm(`确认删除${name}吗`);
  if (flag) {
    fetch(`/api/restaurants/${id}`, {
      method: "DELETE",
    }).then(() => {
      fetchRestaurants();
    });
  }
}

function editRestaurant(id, name) {
  const newName = prompt("请输入新的名称", name);
  if (newName) {
    fetch(`/api/restaurants/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: newName }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.error) {
          showErrorMessage(data.error);
        } else {
          fetchRestaurants();
        }
      });
  }
}

function showErrorMessage(message) {
  const errorMessage = document.getElementById("error-message");
  errorMessage.textContent = message;
  errorMessage.style.display = '';
  clearTimeout(window.errorMessageTimer);
  window.errorMessageTimer = setTimeout(() => {
    errorMessage.style.display = 'none';
  }, 3000);
}

function spinWheel(ev) {
  if (spining) {
    return;
  }
  spining = true;
  const btn = document.getElementById('btn-spin');
  btn.disabled = true;
  return fetch("/api/spin", {
    method: "POST",
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.error) {
        showErrorMessage(data.error);
        spining = false;
        btn.disabled = false;
        return;
      }

      return playSpin(data);
    }).finally(() => {
      spining = false;
      btn.disabled = false;
    });
}

function playSpin(data) {
  return new Promise((resolve, reject) => {
    if (!data) {
      return reject("Invalid data")
    };
    const { name, ip, timestamp } = data;
    const restaurants = document.getElementsByClassName("restaurant-item");
    const randomIndex = Array.from(restaurants).findIndex((item) =>
      item.textContent.includes(name)
    );
  
    // 动画效果
    let currentIndex = 0;
    const interval = setInterval(() => {
      highlightRestaurant(restaurants[currentIndex].textContent.trim());
      currentIndex = (currentIndex + 1) % restaurants.length;
    }, 100);
  
    setTimeout(() => {
      clearInterval(interval);
      setCurr(data);
      fetchHistory();
      resolve();
    }, 3000);
  })
}

function normalizeIp(ip) {
  return ip.replace('::ffff:', '')
}

function setCurr(data) {
  const { name, ip, timestamp } = data;
  document.getElementById(
    "selected-restaurant"
  ).textContent = `今天吃【${name}】`;
  document.getElementById(
    "selection-info"
  ).textContent = `最新结果由[${normalizeIp(ip)}]在[${new Date(
    timestamp
  ).toLocaleString()}]随机生成`;
  highlightRestaurant(name);
  currRestaurant = data;
}

function highlightRestaurant(name) {
  const restaurantItems = document.getElementsByClassName("restaurant-item");
  for (const item of restaurantItems) {
    if (item.textContent.includes(name)) {
      item.classList.add("highlight");
    } else {
      item.classList.remove("highlight");
    }
  }
}

function fetchHistory() {
  const cMap = {};
  let cIndex = 0;
  return fetch("/api/history")
    .then((response) => response.json())
    .then((data) => {
      const historyList = document.getElementById("history-list");
      historyList.innerHTML = "";
      // 时间正序设置颜色
      for (let i = data.data.length - 1; i >= 0; i--) {
        const entry = data.data[i];
        if (!cMap[entry.ip]) {
          cMap[entry.ip] = {};
          if (!colors[cIndex]) {
            cIndex = 0;
          }
          cMap[entry.ip].color = colors[cIndex++];
          cMap[entry.ip].count = 1;
        } else {
          cMap[entry.ip].count++;
        }
      }
      // 时间倒序显示
      data.data.forEach((entry) => {
        const div = document.createElement("div");
        div.className = "history-item";
        div.textContent = `[${new Date(entry.timestamp).toLocaleString()}] ${
          normalizeIp(entry.ip)
        }: ${entry.name}`;
        div.style.color = cMap[entry.ip].color;
        historyList.appendChild(div);
        setCurr(data.data[0]);
      });
    });
}
