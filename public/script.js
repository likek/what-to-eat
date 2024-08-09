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
const restaurantNameMaxlength = 9;
let ws;
let reconnectInterval = 3000;
let reconnectTimer;
let currUser = null;

function addDebugClick(node, callback, triggerCount = 5) {
  node.addEventListener('click', () => {
    if (window.debugClickTimer) {
        window.clearTimeout(window.debugClickTimer)
    }
    if (typeof window.debugTouchCount !== 'number') {
        window.debugTouchCount = 0
    }
    window.debugTouchCount++
    window.debugClickTimer = setTimeout(() => {
        if (typeof window.debugTouchCount === 'number' && window.debugTouchCount >= triggerCount) {
            callback()
        }
        window.debugTouchCount = 0
    }, 300)
  })
}

function resetRound() {
  const flag = window.confirm(`确定重开一轮吗(上一轮将清空)`);
  if (flag) {
    fetch(`/api/history`, {
      method: "DELETE",
    }).then(() => {
      fetchHistory();
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  fetchRestaurants().finally(() => {
    fetchHistory();
  });
  checkForUpdates();
  registeUserId();
});

function registeUserId() {
  return fetch('/register')
  .then(response => response.text())
  .then(data => {
    return fetch('/api/userInfo')
  })
  .then(res => res.json())
  .then(data => {
    currUser = data.data;
    connectWs();
    if (data.data.id) {
      document.getElementById("user_id").innerHTML = data.data.id;
    }
  })
  .catch(error => console.error('Error:', error));
}

function connectWs() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}`);
  ws.onopen = function (event) {
    clearInterval(reconnectTimer);
    console.log("ws connected");
  };

  ws.onmessage = function (event) {
    let data = {}
    try {
      data = JSON.parse(event.data)
    } catch(e) {
      console.error('消息解析错误:', error, data)
    }
    switch(data.event) {
      case 'update_restaurant':
      case 'delete_restaurant':
      case 'create_restaurant':
        clearTimeout(window.refreshRestaurantsTimer)
        window.refreshRestaurantsTimer = setTimeout(() => {
          fetchRestaurants();
        }, 500)
        break
      case 'spin':
      case 'delete_today_history':
        clearTimeout(window.refreshHistoryTimer)
        window.refreshHistoryTimer = setTimeout(() => {
          fetchHistory();
        }, 500)
        break
      case 'online_users_update':
        const users = data.data.users.filter(item => item.id !== currUser?.id)
        const usersDom = document.getElementById('users')
        usersDom.innerHTML = users.map(item => item.id).join(',')
        break
      default:
        console.warn('未知消息类型:', data.event, data.data)
    }
  };

  ws.onclose = function (event) {
    startReconnectTimer();
    console.log("ws connection closed:", event);
  };

  ws.onerror = function (error) {
    console.error("ws error:", error);
  };
  return ws;
}

function startReconnectTimer() {
  clearInterval(reconnectTimer);
  reconnectTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not connected. Attempting to reconnect...');
      connectWs();
    }
  }, reconnectInterval);
}

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
        if (restaurant.id === currRestaurant?.restaurant_id) {
          div.classList.add("highlight");
        }

        const img = document.createElement("img");
        img.src = "./assets/icon_edit.png";
        img.classList.add("edit-btn", "pointer");
        img.onclick = function () {
          editRestaurantName(restaurant);
        };
        div.appendChild(img);

        const name = document.createElement("span");
        name.innerHTML = restaurant.name;
        name.classList.add("restaurant-name");
        div.appendChild(name)

        const delbtn = document.createElement("img");
        delbtn.className = "btn-del";
        delbtn.classList.add('pointer')
        delbtn.src = './assets/icon_del.png';
        delbtn.onclick = function () {
          deleteRestaurant(restaurant.id, restaurant.name);
        };
        div.appendChild(delbtn);

        const weight = document.createElement("span");
        weight.innerHTML = `权重(${restaurant.weight})`;
        weight.classList.add("restaurant-weight", "pointer")
        weight.onclick = function () {
          editRestaurantWeight(restaurant);
        };
        div.appendChild(weight);

        restaurantList.appendChild(div);
      });
    });
}

function addRestaurant() {
  let name = document.getElementById("restaurant-name").value;
  name = name.trim();
  if (name.trim() === "") {
    alert("请输入有效的饭店名");
    return;
  }
  if(name.length > restaurantNameMaxlength) {
    alert(`饭店名不能超过${restaurantNameMaxlength}个字符`)
    return
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

function editRestaurant(restaurant) {
  const { id, name, weight } = restaurant;
  return fetch(`/api/restaurants/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, weight }),
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

function editRestaurantName(restaurant) {
  const { id, name, weight } = restaurant;
  let newName = prompt("请输入新的名称", name);
  if (newName) {
    newName = newName.trim();
    if (newName.trim() === "") {
      alert("请输入有效的饭店名");
      return;
    }
    if(newName.length > restaurantNameMaxlength) {
      alert(`饭店名不能超过${restaurantNameMaxlength}个字符`)
      return
    }
    if (name === newName) {
      return;
    }
    return editRestaurant({ id, name: newName, weight })
  }
}

function editRestaurantWeight(restaurant) {
  const { id, name, weight } = restaurant;
  const newWeight = prompt("请输入新的权重(0~100)", weight);
  if (newWeight) {
    if(!/^\d+$/.test(newWeight) || newWeight < 0 || newWeight > 100) {
      alert('权重值必须为0~100的整数')
      return
    }
    return editRestaurant({ id, name, weight: newWeight })
  }
}

function showErrorMessage(message) {
  const errorMessage = document.getElementById("error-message");
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
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
      fetchHistory();
      resolve();
    }, 3000);
  })
}

function normalizeIp(ip) {
  return ip.replace('::ffff:', '')
}

function setCurr(data) {
  if(!data) {
    document.getElementById(
      "selected-restaurant"
    ).textContent = '';
    highlightRestaurant(undefined);
    currRestaurant = null;
    return
  }
  const { name, ip, timestamp } = data;
  document.getElementById(
    "selected-restaurant"
  ).textContent = `今天吃【${name}】`;
  // document.getElementById(
  //   "selection-info"
  // ).textContent = `最新结果由[${normalizeIp(ip)}]在[${new Date(
  //   timestamp
  // ).toLocaleString()}]随机生成`;
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
  const colorOfIpMap = {};
  let cIndex = 0;
  return fetch("/api/history")
    .then((response) => response.json())
    .then((data) => {
      const statistics = document.getElementById("statistics");
      const historyList = document.getElementById("history-list");
      historyList.innerHTML = "";
      statistics.innerHTML = "";
      statistics.style.textAlign='left';
      statistics.style.fontSize = '13px';
      // 时间正序设置颜色
      for (let i = data.data.length - 1; i >= 0; i--) {
        const entry = data.data[i];
        if (!colorOfIpMap[entry.create_user_id]) {
          colorOfIpMap[entry.create_user_id] = {};
          if (!colors[cIndex]) {
            cIndex = 0;
          }
          colorOfIpMap[entry.create_user_id].color = colors[cIndex++];
          colorOfIpMap[entry.create_user_id].count = 1;
        } else {
          colorOfIpMap[entry.create_user_id].count++;
        }
      }

      const latestItemOfIpMap = {}
      const restaurantCountMap = {};
      // 时间倒序显示
      data.data.forEach((entry) => {
        const div = document.createElement("div");
        div.className = "history-item";

        if (!latestItemOfIpMap[entry.create_user_id]) {
          // 最新
          latestItemOfIpMap[entry.create_user_id] = entry;
          div.style.textDecoration = 'none';
          div.style.background = '#ccc';
          div.style.borderRadius = '5px';

          if(!restaurantCountMap[entry.name]) {
            restaurantCountMap[entry.name] = {
              count: 1,
              data: entry
            };
          } else {
            restaurantCountMap[entry.name].count++;
          }
        } else {
          // 旧的
          div.style.textDecoration = 'line-through';
          div.style.background = '';
          div.style.borderRadius = '';
        }
        div.textContent = `用户 [${ entry.create_user_id }] 在 [${new Date(entry.timestamp).toLocaleString()}] 随机: ${entry.name}`;
        div.style.color = colorOfIpMap[entry.create_user_id].color;
        historyList.appendChild(div);
      });

      const resRestaurantNameList = Object.keys(restaurantCountMap)
      const statisticsStr = resRestaurantNameList.map(name => `${name}<span style='color: #f00;'>${restaurantCountMap[name].count}</span>票`).join('、');
      const totalCount = Object.keys(latestItemOfIpMap).length;
      if (!totalCount) {
        statistics.innerHTML = `<span style="color: #999;">今天还没有用户投票，快来投一票吧！</spna>`
      } else {
        statistics.innerHTML = `<span style="color: #999;">本轮总共${Object.keys(latestItemOfIpMap).length}个用户投票,${resRestaurantNameList.length}个地方获得了投票:</span> ${statisticsStr}。`
      }
      
      if (data.data.length > 0) {
        historyList.style.display = '';
      } else {
        historyList.style.display = 'none';
      }

      const maxCountRestaurantData = Object.keys(restaurantCountMap).reduce((maxKey, currKey) => {
        if (restaurantCountMap[currKey].count > restaurantCountMap[maxKey].count) {
          return currKey;
        } else if (restaurantCountMap[currKey].count === restaurantCountMap[maxKey].count) {
          if (restaurantCountMap[currKey].data.timestamp > restaurantCountMap[maxKey].data.timestamp) {
            return currKey;
          }
        }
        return maxKey;
      }, Object.keys(restaurantCountMap)[0]);

      const maxCountRestaurant = restaurantCountMap[maxCountRestaurantData]?.data;

      setCurr(maxCountRestaurant);
      return restaurantCountMap;
    });
}
