/** 统一成功信封（与服务端 Exception/Envelope 对齐） */
declare type Envelope<T> = {
  code: number
  success: boolean
  msg: string
  data: T
  timestamp?: number
}
