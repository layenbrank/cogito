interface SlideProof {
  captchaKey: string
  captchaValue: string
  captchaKind?: string
}

interface SignInBody extends SlideProof {
  username: string
  password: string
}

interface SignUpBody extends SlideProof {
  username: string
  password: string
}

interface AuthUser {
  id: string
  username: string
  role: string
  status: string
  createdAt: number
  updatedAt: number
}

interface SignInResult extends AuthUser {
  token: string
}

interface Avatar {
  id: string
  url: string
  mime: string
  name: string
}

interface Profile extends AuthUser {
  email: string | null
  phone: string | null
  gender: string | null
  birthday: string | null
  age: number | null
  avatar: Avatar | null
}

interface ProfileUpdateBody {
  email?: string | null
  phone?: string | null
  gender?: 'MALE' | 'FEMALE' | null
  birthday?: string | null
  avatar?: string | null
}

interface PasswordChangeBody {
  oldPassword: string
  newPassword: string
}

interface CaptchaChallenge {
  kind: string
  captchaKey: string
  masterImage: string
  thumbImage: string
  thumbX: number
  thumbY: number
  thumbWidth: number
  thumbHeight: number
}

interface Session {
  token: string
  userId: string
  username: string
}

export type {
  AuthUser,
  Avatar,
  CaptchaChallenge,
  PasswordChangeBody,
  Profile,
  ProfileUpdateBody,
  Session,
  SignInBody,
  SignInResult,
  SignUpBody,
  SlideProof
}
