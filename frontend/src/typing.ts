export interface IUserInfo {
    id: number,
    uniqueId: string,
}

export interface IWsMessage {
    event: string,
    data: any
}

export interface IRestaurant {
    id: number,
    name: string,
    weight?: number
}

export interface ISelectionItem {
    id: number
    create_user_id: number
    disabled: 0 | 1
    ip: string
    name: string
    restaurant_id: number;
    timestamp: string
}