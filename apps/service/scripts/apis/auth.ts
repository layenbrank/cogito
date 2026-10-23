import { http } from '../utils/http.ts'
import { HttpResponse } from '../utils/http.errors.ts'

const API_BASE_URL = 'api/v1/auth'

function POST_SIGNIN(data: Auth.SignIn.Params) {
  return HttpResponse<Auth.SignIn.Response>(http.post(`${API_BASE_URL}/signin`, { json: data }))
}

function POST_SIGNUP(data: Auth.SignUp.Params) {
  return HttpResponse<Auth.SignUp.Response>(http.post(`${API_BASE_URL}/signup`, { json: data }))
}

export { POST_SIGNIN, POST_SIGNUP }
