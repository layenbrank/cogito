export type Constructor<T = any> = new (...args: any[]) => T

/**
 * 单例模式装饰器
 * 确保类只有一个实例，并提供全局访问点
 * 使用方式: @Singleton()
 */
export function Singleton() {
  return function <T extends new (...args: any[]) => any>(constructor: T): T {
    // 实例存储
    let instance: InstanceType<T> | null = null

    let proxiedConstructor: T

    // 创建代理类
    // eslint-disable-next-line prefer-const
    proxiedConstructor = new Proxy(constructor, {
      construct(target: T, args: any[], newTarget: any): InstanceType<T> {
        // When called via `super()` from a derived class constructor,
        // `newTarget` is the derived constructor. In that case we must NOT
        // return the base singleton instance, otherwise the derived instance
        // will become the base instance.
        if (newTarget !== proxiedConstructor) {
          return Reflect.construct(target, args, newTarget) as InstanceType<T>
        }

        if (!instance) {
          try {
            instance = Reflect.construct(target, args, newTarget) as InstanceType<T>
          } catch (error) {
            console.error(`创建 ${constructor.name} 单例时出错:`, error)
            throw error
          }
        }

        // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
        return instance as InstanceType<T>
      }
    })

    return proxiedConstructor
  }
}
