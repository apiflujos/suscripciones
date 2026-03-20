declare module "@suscripciones/database" {
  export const prisma: {
    $queryRawUnsafe<T = any>(...args: any[]): Promise<T>;
    $queryRaw<T = any>(...args: any[]): Promise<T>;
    $transaction<T = any>(...args: any[]): Promise<T>;
    $connect(...args: any[]): Promise<void>;
    $disconnect(...args: any[]): Promise<void>;
    [key: string]: any;
  };
}
