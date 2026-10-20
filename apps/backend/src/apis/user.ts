import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface UserAvatar {
  id: string
  url: string
  mime: string
  name: string
}

interface UserRecord {
  id: string
  username: string
  role: string
  status: string
  email: string | null
  phone: string | null
  gender: string | null
  birthday: string | null
  age: number | null
  avatar: UserAvatar | null
  createdAt: number
  updatedAt: number
}

interface UserWrite {
  username: string
  password: string
  role?: string
}

interface UserUpdate {
  username?: string
  password?: string
  email?: string | null
  phone?: string | null
  gender?: string | null
  birthday?: string | null
  age?: number
  avatar?: string | null
  role?: string
  status?: string
}

const ENV = { env: 'thinking' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

function GET_USERS() {
  return unwrap(http.get<RSF<UserRecord[]>>('/users', ENV))
}

function GET_USER(id: string) {
  return unwrap(http.get<RSF<UserRecord>>(`/users/${id}`, ENV))
}

function POST_USER(body: UserWrite) {
  return unwrap(http.post<RSF<UserRecord>>('/users', body, ENV))
}

function PUT_USER(id: string, body: UserUpdate) {
  return unwrap(http.put<RSF<UserRecord>>(`/users/${id}`, body, ENV))
}

function DELETE_USER(id: string) {
  return unwrap(http.delete<RSF<null>>(`/users/${id}`, ENV))
}

export { DELETE_USER, GET_USER, GET_USERS, POST_USER, PUT_USER }
export type { UserRecord, UserUpdate, UserWrite }
