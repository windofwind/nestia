/**
 * @packageDocumentation
 * @module api.functional.bbs.articles
 * @nestia Generated by Nestia - https://github.com/samchon/nestia 
 */
//================================================================
import type { IConnection, Primitive, Resolved } from "@nestia/fetcher";
import { PlainFetcher } from "@nestia/fetcher/lib/PlainFetcher";

import type { IBbsArticle } from "../../../structures/IBbsArticle";
import type { IPage } from "../../../structures/IPage";

export * as comments from "./comments";

/**
 * @controller BbsArticlesController.index
 * @path GET /bbs/:section/articles
 * @nestia Generated by Nestia - https://github.com/samchon/nestia
 */
export async function index(
    connection: IConnection,
    section: string,
    query: index.Query,
): Promise<index.Output> {
    return PlainFetcher.fetch(
        connection,
        {
            ...index.METADATA,
            path: index.path(section, query),
        } as const,
    );
}
export namespace index {
    export type Query = Resolved<IPage.IRequest>;
    export type Output = Primitive<IPage<IBbsArticle.ISummary>>;

    export const METADATA = {
        method: "GET",
        path: "/bbs/:section/articles",
        request: null,
        response: {
            type: "application/json",
            encrypted: false,
        },
        status: null,
    } as const;

    export const path = (section: string, query: index.Query): string => {
        const variables: Record<any, any> = query as any;
        const search: URLSearchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(variables))
            if (value === undefined) continue;
            else if (Array.isArray(value))
                value.forEach((elem) => search.append(key, String(elem)));
            else
                search.set(key, String(value));
        const encoded: string = search.toString();
        return `/bbs/${encodeURIComponent(section ?? "null")}/articles${encoded.length ? `?${encoded}` : ""}`;;
    }
}

/**
 * Store a new article.
 * 
 * @param section Section code
 * @param input Content to store
 * @returns Newly archived article
 * 
 * @controller BbsArticlesController.store
 * @path POST /bbs/:section/articles
 * @nestia Generated by Nestia - https://github.com/samchon/nestia
 */
export async function store(
    connection: IConnection,
    section: string,
    input: store.Input,
): Promise<store.Output> {
    return PlainFetcher.fetch(
        {
            ...connection,
            headers: {
                ...(connection.headers ?? {}),
                "Content-Type": "application/json",
            },
        },
        {
            ...store.METADATA,
            path: store.path(section),
        } as const,
        input,
    );
}
export namespace store {
    export type Input = Primitive<IBbsArticle.IStore>;
    export type Output = Primitive<IBbsArticle>;

    export const METADATA = {
        method: "POST",
        path: "/bbs/:section/articles",
        request: {
            type: "application/json",
            encrypted: false
        },
        response: {
            type: "application/json",
            encrypted: false,
        },
        status: null,
    } as const;

    export const path = (section: string): string => {
        return `/bbs/${encodeURIComponent(section ?? "null")}/articles`;
    }
}