import {
    useContext,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { NaturContext } from "./context";
import MapCache from "./MapCache";
import {
    Modules,
    LazyStoreModules,
    Store,
    Fun,
    ModuleDepDec,
    InjectStoreModule,
} from "./ts-utils";
import { arrayIsEqual } from "./utils";

export function getDepValue<
    D extends {
        state?: Array<string | Fun<any>>;
        maps?: string[];
    }
>(sm: InjectStoreModule, dep: D) {
    let stateDepGetter: Array<Fun<any>> = [];
    let mapsDepGetter: Array<Fun<any>> = [];
    let res: any[] = [];
    if (dep.state) {
        stateDepGetter = dep.state.map((keyPath) => {
            if (typeof keyPath !== "function") {
                return (s: any) => {
                    return MapCache.getValueFromState(s, keyPath);
                };
            }
            return keyPath;
        });
        res.push(...stateDepGetter.map((i) => i(sm.state)));
    }
    if (dep.maps) {
        mapsDepGetter = dep.maps.map((keyPath) => {
            return (s: any) => {
                return MapCache.getValueFromState(s, keyPath);
            };
        });
        res.push(...mapsDepGetter.map((i) => i(sm.maps)));
    }
    return res;
}
export type FlatModule<
    T extends InjectStoreModule,
    S = T["state"],
    M = T["maps"],
    A = T["actions"],
    MK = M extends undefined | null ? never : Extract<keyof M, string>
> = MK extends never
    ? {
            [k in keyof S]: S[k];
      } & {
            [k in keyof A]: A[k];
      }
    : {
            [k in Exclude<keyof S, keyof M>]: S[k];
      } & {
            [k in keyof A]: A[k];
      } & {
            [k in keyof M]: M[k];
      };

export type CreateUseInjectOptions<F extends boolean|undefined> = {
    flat?: F;
};

function createUseInject<
    M extends Modules,
    LM extends LazyStoreModules,
    F = false
>(storeInsGetter: () => Store<M, LM>): <
    K extends keyof ST,
    D extends ModuleDepDec<ST, K>[1],
    ST extends Store<M, LM>['type'] = Store<M, LM>['type'],
    R1 = ST[K],
    R = K extends keyof M ? [R1, false, undefined] : [R1, false, undefined | Error] | [undefined, true, undefined | Error]
>(moduleName: K, dep?: D) => R;

function createUseInject<
    M extends Modules,
    LM extends LazyStoreModules,
    F = false
>(storeInsGetter: () => Store<M, LM>, opt: CreateUseInjectOptions<undefined>): <
    K extends keyof ST,
    D extends ModuleDepDec<ST, K>[1],
    ST extends Store<M, LM>['type'] = Store<M, LM>['type'],
    R1 = ST[K],
    R = K extends keyof M ? [R1, false, undefined] : [R1, false, undefined | Error] | [undefined, true, undefined | Error]
>(moduleName: K, dep?: D) => R;

function createUseInject<
    M extends Modules,
    LM extends LazyStoreModules,
    F extends boolean,
>(storeInsGetter: () => Store<M, LM>, opt: CreateUseInjectOptions<F>): <
    K extends keyof ST,
    D extends ModuleDepDec<ST, K>[1],
    ST extends Store<M, LM>['type'] = Store<M, LM>['type'],
    R1 = F extends true ? FlatModule<ST[K]> : ST[K],
    R = K extends keyof M ? [R1, false, undefined] : [R1, false, undefined | Error] | [undefined, true, undefined | Error]
>(moduleName: K, dep?: D) => R;

function createUseInject<
    M extends Modules,
    LM extends LazyStoreModules,
    F extends boolean|undefined
>(storeInsGetter: () => Store<M, LM>, opt?: CreateUseInjectOptions<F>) {
    type ST = Store<M, LM>["type"];
    const { flat = false } = opt || {};
    /**
     * natur hooks函数
     */
    function useInject<
        K extends keyof ST,
        D extends ModuleDepDec<ST, K>[1],
        R1 = F extends true ? FlatModule<ST[K]> : ST[K],
        R = K extends keyof M
            ? [R1, false, undefined]
            :
                    | [R1, false, undefined | Error]
                    | [undefined, true, undefined | Error]
    >(moduleName: K, dep?: D): R {
        const stateRef = useRef<ST[K]>();
        const [error, setError] = useState<Partial<Record<K, Error>>>({});
        const storeIns =
            (useContext(NaturContext) as Store<M, LM> | undefined) ||
            storeInsGetter();
        const [loading, setLoading] = useState<Partial<Record<K, boolean>>>({});
        const res = useSyncExternalStore(
            (on) => storeIns.subscribe(moduleName, on),
            () => {
                if (storeIns.hasModule(moduleName)) {
                    if (loading[moduleName]) {
                        setLoading((nl) => ({
                            ...nl,
                            [moduleName]: false,
                        }));
                    }
                    const m = storeIns.getModule(moduleName);
                    if (m !== stateRef.current) {
                        if (
                            stateRef.current &&
                            dep &&
                            arrayIsEqual(
                                getDepValue(stateRef.current, dep as any),
                                getDepValue(m, dep as any)
                            )
                        ) {
                            return stateRef.current;
                        }
                        stateRef.current = m;
                    }
                    return stateRef.current;
                } else {
                    if (error[moduleName]) {
                        return;
                    }
                    if (!loading[moduleName]) {
                        setLoading((nl) => ({
                            ...nl,
                            [moduleName]: true,
                        }));
                    }
                    if (storeIns.getAllModuleName().includes(moduleName)) {
                        storeIns
                            .loadModule(moduleName as keyof LM)
                            .catch((err) => {
                                setError((e) => ({
                                    ...e,
                                    [moduleName]: err,
                                }));
                            })
                            .finally(() => {
                                setLoading((nl) => ({
                                    ...nl,
                                    [moduleName]: false,
                                }));
                            });
                    }
                    return;
                }
            }
        );
        const finalRes = useMemo(() => {
            if (flat && res) {
                return {
                    ...res.state,
                    ...res.actions,
                    ...(res.maps || {}),
                };
            }
            return res;
        }, [res]);
        return [
            finalRes,
            loading[moduleName] === undefined ? !storeIns.hasModule(moduleName) : !!loading[moduleName],
            error[moduleName]
        ] as R;
    }
    return useInject;
}

export { createUseInject };

