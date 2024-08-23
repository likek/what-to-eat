<template>
    <div class="restaurant-item" :class="{ highlight: isHighlighted }">
      <img
        src="@/assets/icon_edit.png"
        alt="Edit"
        class="edit-btn pointer"
        @click="handleEdit"
      />
      <span class="restaurant-name">{{ restaurant.name }}</span>
      <img
        src="@/assets/icon_del.png"
        alt="Delete"
        class="btn-del pointer"
        @click="handleDelete"
      />
      <span
        class="restaurant-weight pointer"
        @click="handleEditWeight"
      >权重({{ restaurant.weight }})</span>
    </div>
  </template>
  
  <script setup lang="ts">
  
  // 假设这些方法已经定义在父组件中并通过 props 传递过来
  const props = defineProps({
    restaurant: {
      type: Object,
      required: true,
    },
    isHighlighted: {
      type: Boolean,
      default: false,
    },
  });
  
  const emit = defineEmits(['edit-restaurant', 'delete-restaurant', 'edit-weight']);
  
  const handleEdit = () => {
    emit('edit-restaurant', props.restaurant);
  };
  
  const handleDelete = () => {
    emit('delete-restaurant', props.restaurant.id, props.restaurant.name);
  };
  
  const handleEditWeight = () => {
    emit('edit-weight', props.restaurant);
  };
  </script>
  
  <style scoped>

.restaurant-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 6px;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin: 2px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.restaurant-name {
  margin-right: auto;
}

.restaurant-item.highlight {
  background-color: #ffeb3b;
}
  .pointer {
    cursor: pointer;
  }
  </style>