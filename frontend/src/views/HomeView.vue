<template>
    <div class="container">
      <div style="color: #999;text-align: left;font-size: 10px;">当前用户: <span>{{ currUser?.id }}</span></div>
      <div style="color: #999;text-align: left;font-size: 10px;">其他在线用户: <span>{{ otherUsers.map(item => item.id).join(',') }}</span></div>
      <h3 class="title">今天吃什么</h3>
      <div class="restaurant-list">
        <restaurant-item 
          v-for="restaurant in restaurantList" :key="restaurant.id" 
          :restaurant="restaurant" 
          :is-highlighted="currHeighLightRestaurant?.id === restaurant.id"
          @edit-restaurant="handleEditRestaurant"
          @delete-restaurant="handleDeleteRestaurant"
          @edit-weight="handleEditWeight"
        ></restaurant-item>
      </div>
      <div class="add-restaurant">
        <input ref="refInput" type="text" class="restaurant-input" placeholder="加个新的地儿" />
        <button @click="addRestaurant()">添加</button>
      </div>
      <div v-show="errorMessage">{{ errorMessage }}</div>
      <button class="spin-button" @click="spinWheel" :disabled="btnSpinDisabled">今天吃什么</button>
      <div class="selected-restaurant">
        <span v-if="currRestaurant">今天吃{{ currRestaurant.name }}</span>
      </div>
      <div class="selection-info"></div>
      <div v-html="statisticsTxt"></div>
      <div style="display: flex;justify-content: end;">
        <button v-if="historyList.length" id="reset_round" style="background-color: burlywood;" @click="resetRound()">重开一轮</button>
      </div>
      <div class="history-list">
        <div
        v-for="(entry) in historyList"
        :key="entry.id"
        :class="['history-item', { 'latest': latestItemOfIpMap[entry.create_user_id].id === entry.id, 'old': latestItemOfIpMap[entry.create_user_id].id !== entry.id }]"
        :style="{ color: colorOfIpMap[entry.create_user_id].color }"
      >
        用户 [{{ entry.create_user_id }}] 在 [{{ new Date(entry.timestamp).toLocaleString() }}] 随机: {{ entry.name }}
        </div>
      </div>
    </div>
</template>

<script setup lang="ts">
import type { IRestaurant, ISelectionItem, IUserInfo, IWsMessage } from '@/typing';
import { onMounted, ref } from 'vue';
import { colors } from '@/config';
import RestaurantItem from '@/components/RestaurantItem.vue';
import { httpFetch } from '@/utils';


const restaurantList = ref<IRestaurant[]>([]);
const historyList = ref<ISelectionItem[]>([]);
const currRestaurant = ref<IRestaurant>();
const currHeighLightRestaurant = ref<IRestaurant>();
let currUser = ref<IUserInfo>();
const otherUsers = ref<IUserInfo[]>([]);
const refInput = ref<HTMLInputElement>();
const errorMessage = ref<string>()
const btnSpinDisabled = ref(false);
const statisticsTxt = ref<string>('');

const colorOfIpMap = ref<Record<number, { color: string; count: number }>>({});
const latestItemOfIpMap = ref<Record<number, ISelectionItem>>({});
const restaurantCountMap = ref<Record<number, { count: number; data: ISelectionItem}>>({});

onMounted(() => {
  registeUserId().then(() => {
    return fetchRestaurants()
  }).then(() => {
    fetchHistory();
  });
  checkForUpdates();
})




let currentVersion: string;
let spining = false;
const restaurantNameMaxlength = 9;
let ws: WebSocket;
let reconnectInterval = 3000;
let reconnectTimer: number;

function resetRound() {
  const flag = window.confirm(`确定重开一轮吗(上一轮将清空)`);
  if (flag) {
    httpFetch(`/api/history`, {
      method: "DELETE",
    }).then(() => {
      fetchHistory();
    });
  }
}

function registeUserId() {
  return httpFetch('/register', {
    credentials: 'include'
  })
  .then(response => response.text())
  .then(data => {
    return httpFetch('/api/userInfo')
  })
  .then(res => res.json())
  .then(data => {
    currUser.value = data.data;
    connectWs();
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
    let data: IWsMessage | undefined;
    try {
      data = JSON.parse(event.data) as IWsMessage
    } catch(e) {
      console.error('消息解析错误:', e, data)
    }
    switch(data?.event) {
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
        {
          const users = (data.data.users as IUserInfo[]).filter(item => item.id !== currUser.value?.id)
          otherUsers.value = users
        }
        break
      default:
        console.warn('未知消息类型:', data?.event, data?.data)
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
  httpFetch("/api/version")
    .then((response) => response.json())
    .then((data) => {
      const version = data.version;
      if (currentVersion && currentVersion !== version) {
        if (confirm("检测到更新，是否立即更新？")) {
          location.reload();
        }
      }
      currentVersion = version;
    });

  setTimeout(checkForUpdates, 60000); // 每分钟检查一次
}

function handleDeleteRestaurant(id: number, name: string) {
  const flag = window.confirm(`确认删除${name}吗`);
  if (flag) {
    httpFetch(`/api/restaurants/${id}`, {
      method: "DELETE",
    }).then(() => {
      fetchRestaurants();
    });
  }
}

function fetchRestaurants() {
  return httpFetch("/api/restaurants")
    .then((response) => response.json())
    .then((data) => {
      restaurantList.value = data.data;
    });
}

function addRestaurant() {
  let name = refInput.value?.value || '';
  name = name.trim();
  if (name.trim() === "") {
    alert("请输入有效的饭店名");
    return;
  }
  if(name.length > restaurantNameMaxlength) {
    alert(`饭店名不能超过${restaurantNameMaxlength}个字符`)
    return
  }

  httpFetch("/api/restaurants", {
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
        if (refInput.value) {
          refInput.value.value = "";
        }
        showErrorMessage("");
      }
    });
}

function editRestaurant(restaurant: IRestaurant) {
  const { id, name, weight } = restaurant;
  return httpFetch(`/api/restaurants/${id}`, {
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

function handleEditRestaurant(restaurant: IRestaurant) {
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

function handleEditWeight(restaurant: IRestaurant) {
  const { id, name, weight } = restaurant;
  const newWeight = prompt("请输入新的权重(0~100)", weight?.toString());
  if (newWeight) {
    if(!/^\d+$/.test(newWeight) || Number(newWeight) < 0 || Number(newWeight)  > 100) {
      alert('权重值必须为0~100的整数')
      return
    }
    return editRestaurant({ id, name, weight: Number(newWeight)  })
  }
}

function showErrorMessage(message: string) {
  errorMessage.value = message;
  clearTimeout(window.errorMessageTimer);
  window.errorMessageTimer = setTimeout(() => {
    errorMessage.value = '';
  }, 3000);
}

function spinWheel() {
  if (spining) {
    return;
  }
  spining = true;
  btnSpinDisabled.value = true;
  return httpFetch("/api/spin", {
    method: "POST",
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.error) {
        showErrorMessage(data.error);
        spining = false;
        btnSpinDisabled.value = false;
        return;
      }

      return playSpin(data);
    }).finally(() => {
      spining = false;
      btnSpinDisabled.value = false;
    });
}

function playSpin(data: ISelectionItem) {
  return new Promise<void>((resolve, reject) => {
    if (!data) {
      return reject("Invalid data")
    };
    // 动画效果
    let currentIndex = 0;
    const interval = setInterval(() => {
      highlightRestaurant(restaurantList.value[currentIndex]);
      currentIndex = (currentIndex + 1) % restaurantList.value.length;
    }, 100);
  
    setTimeout(() => {
      clearInterval(interval);
      fetchHistory();
      resolve();
    }, 3000);
  })
}

function setCurr(data: ISelectionItem) {
  if(!data) {
    currRestaurant.value = undefined;
    highlightRestaurant(undefined);
    return
  }
  const { name, ip, timestamp } = data;
  const restaurant = {
    id: data.restaurant_id,
    name
  }
  currRestaurant.value = restaurant;
  highlightRestaurant(restaurant);
}

function highlightRestaurant(restaurant: IRestaurant | undefined) {
  currHeighLightRestaurant.value = restaurant
}

async function fetchHistory() {
  try {
    const response = await httpFetch('/api/history').then(res => res.json());
    const data = response.data as ISelectionItem[];

    colorOfIpMap.value = {};
    latestItemOfIpMap.value = {}
    restaurantCountMap.value = {}

    let cIndex = 0;
    for(let i = data.length - 1; i >= 0; i--) {
      const entry = data[i];
      if (!colorOfIpMap.value[entry.create_user_id]) {
        colorOfIpMap.value[entry.create_user_id] = {
          color: colors[cIndex % colors.length],
          count: 1
        };
        cIndex++;
      } else {
        colorOfIpMap.value[entry.create_user_id].count++;
      }
    }

    data.forEach((entry) => {
      if (!latestItemOfIpMap.value[entry.create_user_id]) {
        latestItemOfIpMap.value[entry.create_user_id] = entry;
        if (!restaurantCountMap.value[entry.restaurant_id]) {
          restaurantCountMap.value[entry.restaurant_id] = {
            count: 1,
            data: entry
          };
        } else {
          restaurantCountMap.value[entry.restaurant_id].count++;
        }
      }
    });

    historyList.value = data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const restaurants = Object.values(restaurantCountMap.value)
    const statisticsStr = Object.values(restaurantCountMap.value).map(item => `${item.data.name}<span style='color: #f00;'>${item.count}</span>票`).join('、');
    const totalCount = Object.keys(latestItemOfIpMap.value).length;
    if (!totalCount) {
      statisticsTxt.value = `<span style="color: #999;">今天还没有用户投票，快来投一票吧！</spna>`
    } else {
      statisticsTxt.value = `<span style="color: #999;">本轮总共${totalCount}个用户投票,${restaurants.length}个地方获得了投票:</span> ${statisticsStr}。`
    }

    const maxCountRestaurantId: string = Object.keys(restaurantCountMap.value).reduce((maxKey: string, currKey: string) => {
        if (restaurantCountMap.value[Number(currKey)].count > restaurantCountMap.value[Number(maxKey)].count) {
          return currKey;
        } else if (restaurantCountMap.value[Number(currKey)].count === restaurantCountMap.value[Number(maxKey)].count) {
          if (restaurantCountMap.value[Number(currKey)].data.timestamp > restaurantCountMap.value[Number(maxKey)].data.timestamp) {
            return currKey;
          }
        }
        return maxKey;
      }, Object.keys(restaurantCountMap.value)[0]);

      const maxCountRestaurant = restaurantCountMap.value[Number(maxCountRestaurantId)]?.data;

      setCurr(maxCountRestaurant);
  } catch (error) {
    console.error('Error fetching history:', error);
  }
}

</script>

<style>
body {
  font-family: Arial, sans-serif;
  background-color: #f4f4f4;
  margin: 0;
  padding: 0;
  height: 100vh;
  width: 100%;
  overflow: auto;
}

.pointer {
  cursor: pointer;
}

.container {
  background: white;
  border-radius: 8px;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
  text-align: center;
  margin: 0 auto;
  padding: 10px;
  width: 100%;
  min-height: 100%;
  max-width: 450px;
  box-sizing: border-box;
}

.title {
  margin: 5px auto 0;
}

.add-restaurant {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
}

.restaurant-list {
  margin: 10px 0;
  display: grid;
  gap: 3px;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}

.edit-btn {
  margin-right: 2px;
  width: 10px;
}

.restaurant-weight {
  font-size: 11px;
  color: #999;
}

button {
  padding: 5px 10px;
  border: none;
  background: #007bff;
  color: white;
  border-radius: 4px;
  cursor: pointer;
  margin: 5px;
  padding: 3px 8px;
}

.btn-del {
  margin: 0 4px 0 0;
  width: 12px;
}

button.btn-del:active {
  background-color: #900;
}

button:active {
  background: #0056b3;
}

.restaurant-input {
  padding: 5px;
  border: 1px solid #ddd;
  border-radius: 4px;
  flex-grow: 1;
  margin-right: 5px;
}

#error-message {
  color: red;
  margin-top: 5px;
  display: none;
}

.spin-button {
  margin-top: 5px;
  padding: 6px;
  font-size: 24px;
  background-color: #28a745;
}

.spin-button:hover {
  background: #289945;
}

.spin-button:disabled {
  background-color: #ccc;
}

.selected-restaurant,
.selection-info {
  margin-top: 5px;
  font-size: 1rem;
  color: #28a745;
}

.history-list {
  margin-top: 5px;
  text-align: left;
  /* max-height: 150px; */
  /* overflow-y: auto; */
  background-color: #eee;
  /* opacity: 0.7; */
  padding: 2px 4px;
}

.history-item {
  margin-bottom: 5px;
  color: #999;
  font-size: 12px;
  padding: 0 2px;
}

.history-item.latest {
  text-decoration: none;
  background: #ccc;
  border-radius: 5px;
}

.history-item.old {
  text-decoration: line-through;
  background: none;
  border-radius: none;
}

@media (max-width: 600px) {
  .container {
    padding: 5px;
  }

  .add-restaurant input,
  .add-restaurant button {
    width: 100%;
  }

  .restaurant-list {
    /* grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); */
  }

  h1,
  h2 {
    font-size: 1.5rem;
  }

  .selected-restaurant,
  .selection-info {
    font-size: 16px;
  }
}
</style>
