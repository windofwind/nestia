import fs from "fs";
import NodePath from "path";
import { Singleton } from "tstl/thread/Singleton";
import { VariadicSingleton } from "tstl/thread/VariadicSingleton";
import ts from "typescript";

import { IJsonApplication, IJsonSchema } from "typia";
import { CommentFactory } from "typia/lib/factories/CommentFactory";
import { MetadataCollection } from "typia/lib/factories/MetadataCollection";
import { MetadataFactory } from "typia/lib/factories/MetadataFactory";
import { Metadata } from "typia/lib/metadata/Metadata";
import { ApplicationProgrammer } from "typia/lib/programmers/ApplicationProgrammer";

import { INestiaConfig } from "../INestiaConfig";
import { IRoute } from "../structures/IRoute";
import { ISwaggerDocument } from "../structures/ISwaggerDocument";
import { MapUtil } from "../utils/MapUtil";

export namespace SwaggerGenerator {
    export const generate =
        (checker: ts.TypeChecker) =>
        (config: INestiaConfig.ISwaggerConfig) =>
        async (routeList: IRoute[]): Promise<void> => {
            // PREPARE ASSETS
            const parsed: NodePath.ParsedPath = NodePath.parse(config.output);
            const location: string = !!parsed.ext
                ? NodePath.resolve(config.output)
                : NodePath.join(
                      NodePath.resolve(config.output),
                      "swagger.json",
                  );

            const collection: MetadataCollection = new MetadataCollection({
                replace: MetadataCollection.replace,
            });

            // CONSTRUCT SWAGGER DOCUMENTS
            const tupleList: Array<ISchemaTuple> = [];
            const swagger: ISwaggerDocument = await initialize(location);
            const pathDict: Map<string, ISwaggerDocument.IPath> = new Map();

            for (const route of routeList) {
                if (route.tags.find((tag) => tag.name === "internal")) continue;

                const path: ISwaggerDocument.IPath = MapUtil.take(
                    pathDict,
                    get_path(route.path, route.parameters),
                    () => ({}),
                );
                path[route.method.toLowerCase()] = generate_route(
                    checker,
                    collection,
                    tupleList,
                    route,
                );
            }
            swagger.paths = {};
            for (const [path, routes] of pathDict) {
                swagger.paths[path] = routes;
            }

            // FILL JSON-SCHEMAS
            const application: IJsonApplication = ApplicationProgrammer.write({
                purpose: "swagger",
            })(tupleList.map(({ metadata }) => metadata));
            swagger.components = {
                ...(swagger.components ?? {}),
                schemas: application.components.schemas,
            };
            tupleList.forEach(({ schema }, index) => {
                Object.assign(schema, application.schemas[index]!);
            });

            // CONFIGURE SECURITY
            if (config.security) fill_security(config.security, swagger);

            // ERASE IJsonComponents.IObject.$id
            for (const obj of Object.values(swagger.components.schemas))
                if (obj.$id) delete obj.$id;

            // DO GENERATE
            await fs.promises.writeFile(
                location,
                JSON.stringify(swagger, null, 2),
                "utf8",
            );
        };

    /* ---------------------------------------------------------
        INITIALIZERS
    --------------------------------------------------------- */
    async function initialize(path: string): Promise<ISwaggerDocument> {
        // LOAD OR CREATE NEW SWAGGER DATA
        const swagger: ISwaggerDocument = fs.existsSync(path)
            ? JSON.parse(await fs.promises.readFile(path, "utf8"))
            : {
                  openapi: "3.0.1",
                  servers: [
                      {
                          url: "https://github.com/samchon/nestia",
                          description: "insert your server url",
                      },
                  ],
                  info: {
                      version: "0.1.0",
                      title: "Generated by nestia - https://github.com/samchon/nestia",
                  },
                  paths: {},
                  components: {},
              };

        // RETURNS
        return swagger;
    }

    function get_path(path: string, parameters: IRoute.IParameter[]): string {
        const filtered: IRoute.IParameter[] = parameters.filter(
            (param) => param.category === "param" && !!param.field,
        );
        for (const param of filtered)
            path = path.replace(`:${param.field}`, `{${param.field}}`);
        return path;
    }

    function generate_route(
        checker: ts.TypeChecker,
        collection: MetadataCollection,
        tupleList: Array<ISchemaTuple>,
        route: IRoute,
    ): ISwaggerDocument.IRoute {
        const bodyParam = route.parameters.find(
            (param) => param.category === "body",
        );

        const getTagTexts = (name: string) =>
            route.tags
                .filter(
                    (tag) =>
                        tag.name === name &&
                        tag.text &&
                        tag.text.find(
                            (elem) => elem.kind === "text" && elem.text.length,
                        ) !== undefined,
                )
                .map(
                    (tag) =>
                        tag.text!.find((elem) => elem.kind === "text")!.text,
                );

        const description: string = CommentFactory.string(route.comments);
        const summary: string | undefined = (() => {
            const [explicit] = getTagTexts("summary");
            if (explicit?.length) return explicit;

            const index: number = description.indexOf(".");
            if (index <= 0) return undefined;

            const content: string = description.substring(0, index).trim();
            return content.length ? content : undefined;
        })();

        return {
            tags: getTagTexts("tag"),
            parameters: route.parameters
                .filter((param) => param.category !== "body")
                .map((param) =>
                    generate_parameter(
                        checker,
                        collection,
                        tupleList,
                        route,
                        param,
                    ),
                ),
            requestBody: bodyParam
                ? generate_request_body(
                      checker,
                      collection,
                      tupleList,
                      route,
                      bodyParam,
                  )
                : undefined,
            responses: generate_response_body(
                checker,
                collection,
                tupleList,
                route,
            ),
            summary,
            description,
            "x-nestia-namespace": [
                ...route.path
                    .split("/")
                    .filter((str) => str.length && str[0] !== ":"),
                route.name,
            ].join("."),
            "x-nestia-jsDocTags": route.tags,
        };
    }

    function fill_security(
        security: Required<INestiaConfig.ISwaggerConfig>["security"],
        swagger: ISwaggerDocument,
    ): void {
        swagger.security = [{}];
        swagger.components.securitySchemes = {};

        for (const [key, value] of Object.entries(security)) {
            swagger.security[0]![key] = [];
            swagger.components.securitySchemes[key] = emend_security(value);
        }
    }

    function emend_security(
        input: INestiaConfig.ISwaggerConfig.ISecurityScheme,
    ): ISwaggerDocument.ISecurityScheme {
        if (input.type === "apiKey")
            return {
                ...input,
                in: input.in ?? "header",
                name: input.name ?? "Authorization",
            };
        return input;
    }

    /* ---------------------------------------------------------
        REQUEST & RESPONSE
    --------------------------------------------------------- */
    function generate_parameter(
        checker: ts.TypeChecker,
        collection: MetadataCollection,
        tupleList: Array<ISchemaTuple>,
        route: IRoute,
        parameter: IRoute.IParameter,
    ): ISwaggerDocument.IParameter {
        const schema: IJsonSchema | null = generate_schema(
            checker,
            collection,
            tupleList,
            parameter.type.type,
        );
        if (schema === null)
            throw new Error(
                `Error on NestiaApplication.sdk(): invalid parameter type on ${route.symbol}#${parameter.name}`,
            );

        return {
            name: parameter.field ?? parameter.name,
            in: parameter.category === "param" ? "path" : parameter.category,
            description:
                get_parametric_description(route, "param", parameter.name) ||
                "",
            schema,
            required: required(parameter.type.type),
        };
    }

    function generate_request_body(
        checker: ts.TypeChecker,
        collection: MetadataCollection,
        tupleList: Array<ISchemaTuple>,
        route: IRoute,
        parameter: IRoute.IParameter,
    ): ISwaggerDocument.IRequestBody {
        const schema: IJsonSchema | null = generate_schema(
            checker,
            collection,
            tupleList,
            parameter.type.type,
        );
        if (schema === null)
            throw new Error(
                `Error on NestiaApplication.sdk(): invalid request body type on ${route.symbol}.`,
            );

        return {
            description:
                warning.get(parameter.encrypted).get("request") +
                (get_parametric_description(route, "param", parameter.name) ??
                    ""),
            content: {
                "application/json": {
                    schema,
                },
            },
            required: true,
            "x-nestia-encrypted": parameter.encrypted,
        };
    }

    function generate_response_body(
        checker: ts.TypeChecker,
        collection: MetadataCollection,
        tupleList: Array<ISchemaTuple>,
        route: IRoute,
    ): ISwaggerDocument.IResponseBody {
        // OUTPUT WITH SUCCESS STATUS
        const status: string =
            route.status !== undefined
                ? String(route.status)
                : route.method === "GET" || route.method === "DELETE"
                ? "200"
                : "201";
        const schema: IJsonSchema | null = generate_schema(
            checker,
            collection,
            tupleList,
            route.output.type,
        );
        const success: ISwaggerDocument.IResponseBody = {
            [status]: {
                description:
                    warning.get(route.encrypted).get("response", route.method) +
                    (get_parametric_description(route, "return") ??
                        get_parametric_description(route, "returns") ??
                        ""),
                content:
                    schema === null || route.output.name === "void"
                        ? undefined
                        : {
                              "application/json": {
                                  schema,
                              },
                          },
                "x-nestia-encrypted": route.encrypted,
            },
        };

        // EXCEPTION STATUSES
        const exceptions: ISwaggerDocument.IResponseBody = Object.fromEntries(
            route.tags
                .filter(
                    (tag) =>
                        (tag.name === "throw" || tag.name === "throws") &&
                        tag.text &&
                        tag.text.find(
                            (elem) =>
                                elem.kind === "text" &&
                                isNaN(
                                    Number(
                                        elem.text
                                            .split(" ")
                                            .map((str) => str.trim())[0],
                                    ),
                                ) === false,
                        ) !== undefined,
                )
                .map((tag) => {
                    const text: string = tag.text!.find(
                        (elem) => elem.kind === "text",
                    )!.text;
                    const elements: string[] = text
                        .split(" ")
                        .map((str) => str.trim());

                    return [
                        elements[0],
                        {
                            description: elements.slice(1).join(" "),
                        },
                    ];
                }),
        );
        return { ...exceptions, ...success };
    }

    /* ---------------------------------------------------------
        UTILS
    --------------------------------------------------------- */
    function generate_schema(
        checker: ts.TypeChecker,
        collection: MetadataCollection,
        tupleList: Array<ISchemaTuple>,
        type: ts.Type,
    ): IJsonSchema | null {
        const metadata: Metadata = MetadataFactory.analyze(checker)({
            resolve: false,
            constant: true,
        })(collection)(type);
        if (metadata.empty() && metadata.nullable === false) return null;

        const schema: IJsonSchema = {} as IJsonSchema;
        tupleList.push({ metadata, schema });
        return schema;
    }

    function get_parametric_description(
        route: IRoute,
        tagName: string,
        parameterName?: string,
    ): string | undefined {
        const parametric: (elem: ts.JSDocTagInfo) => boolean = parameterName
            ? (tag) =>
                  tag.text!.find(
                      (elem) =>
                          elem.kind === "parameterName" &&
                          elem.text === parameterName,
                  ) !== undefined
            : () => true;

        const tag: ts.JSDocTagInfo | undefined = route.tags.find(
            (tag) => tag.name === tagName && tag.text && parametric(tag),
        );
        return tag && tag.text
            ? tag.text.find((elem) => elem.kind === "text")?.text
            : undefined;
    }
}

const required = (type: ts.Type): boolean => {
    if (type.isUnion()) return type.types.every((type) => required(type));
    const obstacle = (other: ts.TypeFlags) => (type.getFlags() & other) === 0;
    return (
        obstacle(ts.TypeFlags.Undefined) &&
        obstacle(ts.TypeFlags.Never) &&
        obstacle(ts.TypeFlags.Void) &&
        obstacle(ts.TypeFlags.VoidLike)
    );
};

const warning = new VariadicSingleton((encrypted: boolean) => {
    if (encrypted === false) return new Singleton(() => "");

    return new VariadicSingleton(
        (type: "request" | "response", method?: string) => {
            const summary =
                type === "request"
                    ? "Request body must be encrypted."
                    : "Response data have been encrypted.";

            const component =
                type === "request"
                    ? "[EncryptedBody](https://github.com/samchon/@nestia/core#encryptedbody)"
                    : `[EncryptedRoute.${method![0].toUpperCase()}.${method!
                          .substring(1)
                          .toLowerCase()}](https://github.com/samchon/@nestia/core#encryptedroute)`;

            return `## Warning
${summary}

The ${type} body data would be encrypted as "AES-128(256) / CBC mode / PKCS#5 Padding / Base64 Encoding", through the ${component} component.

Therefore, just utilize this swagger editor only for referencing. If you need to call the real API, using [SDK](https://github.com/samchon/nestia#software-development-kit) would be much better.

-----------------

`;
        },
    );
});

interface ISchemaTuple {
    metadata: Metadata;
    schema: IJsonSchema;
}
