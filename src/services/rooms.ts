import { roomsJsonUrl } from '../utils/urls';

export type Capabilities = {
  capacity: number;
  bookable: boolean;
  tv: boolean;
  pc: boolean;
  audio: boolean;
};

export type Room = {
  id: string;
  url: string;
  nicknames: string[];
  address: string;
  office: string;
  floor: number;
  type: 'lounge' | 'phone-booth' | 'meeting' | 'mothers';
  capabilities: Capabilities;
};

const roomData: Room[] = [];

const hasNickname = (room: Room, query: string) => {
  return !!(
    (room && room.nicknames.length && room.nicknames.find(n => n.toLowerCase().indexOf(query) > -1)) ||
    room.id.replace(/-/gi, ' ').indexOf(query) > -1
  );
};

const http = async <T>(url: string): Promise<Room[]> => {
  return fetch(url)
    .then(response => {
      return response.json() as Promise<Room[]>;
    })
    .catch(e => {
      console.log('Failed to fetch rooms data', e);
      return [];
    });
};

const fetchRoomsData = async (): Promise<Room[]> => {
  if (roomData.length === 0) {
    const fetchedData = await http<Array<Room>>(roomsJsonUrl());
    roomData.push(...fetchedData);
  }

  return roomData;
};

export const getUrlForRoom = async (query: string): Promise<string[]> => {
  const data = await fetchRoomsData();

  const foundRooms: string[] = [];
  if (data && data.length) {
    data.forEach(room => {
      if (hasNickname(room, query)) {
        foundRooms.push(room.url);
      }
    });
  }
  return foundRooms;
};
