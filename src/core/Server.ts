/*
 * Copyright (c) 2020. This code created and belongs to Atlas render manager project.
 * Owner and project architect: Danil Andreev | danssg08@gmail.com |  https://github.com/DanilAndreev
 * Project: atlas-core
 * File last modified: 11/12/20, 5:25 PM
 * All rights reserved.
 */

import * as Koa from "koa";
import {Context, Next} from "koa";
import * as http from "http";
import * as Router from "koa-router";
import * as bodyParser from "koa-body";
import {importClassesFromDirectories} from "typeorm/util/DirectoryExportedClassesLoader";
import {Connection, ConnectionOptions, createConnection, Logger as TypeOrmLogger, QueryRunner} from "typeorm";
import Controller from "./Controller";
import Authenticator from "./Authenticator";
import * as cors from "koa-cors";
import * as Redis from "redis";
import * as Amqp from "amqplib";
import {AMQP_CONNECTION_QUEUE} from "../globals";
import * as TempDirectory from "temp-dir";
import ResponseBody from "../interfaces/ResponseBody";
import Logger from "./Logger";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const convert = require("koa-convert");


namespace Server {
    /**
     * ServerConfig - configuration file for server.
     * @interface
     * @export ServerConfig
     * @author Danil Andreev
     */
    export interface Config {
        /**
         * APP_DEBUG - controls if app is debugging.
         */
        appDebug: boolean,
        /**
         * controllersDir - directory where server should look for controllers.
         * @author Danil Andreev
         */
        controllersDir?: string;
        /**
         * port - port, on which server will start.
         * @author Danil Andreev
         */
        port?: number;
        /**
         * db - database connection options for typeorm
         * @author Danil Andreev
         */
        db: ConnectionOptions;
        /**
         * redis - Redis connection options for redis-typescript.
         */
        redis: Redis.ClientOpts;
        /**
         * rabbit - RabbitMQ connection options for Amqp.
         */
        rabbit: Amqp.Options.Connect;
    }
}

/**
 * Server - basic web server controller. It can load controllers and write log.
 * @class
 * @author Danil Andreev
 * @export default
 * @example
 * const server = new Server({controllersDir: __dirname + "\\controllers\\**\\*"});
 * server.listen(3002);
 */
class Server extends Koa {
    /**
     * ServerConfig - server configuration data.
     * @readonly
     */
    public readonly config: Server.Config;

    /**
     * controllers - array of server controllers. Needs for requests handling.
     */
    protected controllers: Controller[];

    /**
     * router - main server router. Other routers used by it.
     * @readonly
     */
    public readonly router: Router;

    /**
     * DbConnection - connection object for typeorm.
     */
    protected DbConnection: Connection;

    /**
     * RedisConnection - connection object for redis-typescript.
     */
    protected RedisConnection: Redis.RedisClient;

    /**
     * RabbitMQConnection - connection object for RabbitMQ amqp.
     */
    protected RabbitMQConnection: Amqp.Connection;

    /**
     * hasInstance - flag, designed restrict several servers creation.
     * @default false
     */
    private static hasInstance: boolean = false;

    /**
     * current - current active server instance.
     * @default null
     */
    protected static current: Server | null = null;

    /**
     * server - server instance, returned by koaServer.listen().
     * @private
     */
    private server: http.Server;

    /**
     * getCurrent - returns current active server instance.
     * @function
     * @author Danil Andreev
     */
    public static getCurrent(): Server | null {
        return this.current;
    }

    private constructor(config: Server.Config) {
        super();

        this.config = config;
        this.router = new Router();
        this.controllers = [];
    }

    /**
     * getRabbit - returns RabbitMQ connection object.
     * @method
     * @author Danil Andreev
     */
    public getRabbit(): Amqp.Connection {
        return this.RabbitMQConnection;
    }

    /**
     * getRedis - returns Redis connection object.
     * @method
     * @author Danil Andreev
     */
    public getRedis(): Redis.RedisClient {
        return this.RedisConnection;
    }

    /**
     * Creates the Server instance. If you want to run the server - call the ___start()___ method.
     * @constructor
     * @param config - Configuration of the server. Will be merged with ENV.
     * @param options - Additional option for web server.
     * @author Danil Andreev
     */
    public static async createServer(config: Server.Config): Promise<Server> {
        if (Server.hasInstance)
            throw new ReferenceError(`Server: Server instance already exists. Can not create multiple instances of Server.`);

        // Initializing the Server
        Server.hasInstance = true;
        Server.current = new Server(config);
        Logger.info({disableDB: true, verbosity: 1})("Server: Start initialization.").then();

        // TODO: fix koa middleware deprecation!
        Server.current.use(convert(cors({
            origin: "http://monitor.atlasrender.com",
            credentials: true,
            headers: [
                "Content-Type",
                "Origin",
                "Authorization",
                "accept",
                "Accept",
                "Connection",
                "Host",
                "User-Agent",
                "Accept-Encoding",
                "Accept-Language",
                "Content-Length",
                "Referer",
            ]
        })));

        // bodyParser middleware
        Server.current.use(bodyParser({
            formidable: {uploadDir: TempDirectory},
            multipart: true,
            parsedMethods: ["POST", "PUT", "PATCH", "DELETE"]
        }));

        // Creating typeorm connection
        await Server.current.setupDbConnection(config.db);
        Logger.info({disableDB: true, verbosity: 2})("TypeORM: connected to DataBase").then();

        Server.current.setupRedisConnection(config.redis);
        await Server.current.setupRabbitMQConnection(config.rabbit);


        // Creating additional functional for routing.
        Server.current.use(async (ctx: Context, next: Next) => {
            Logger.info({verbosity: 3})(`Server: request from (${ctx.hostname}) to route "${ctx.url}".`).then();
            // Calling next middleware and handling errors
            await next().catch(error => {
                // 401 Unauthorized
                if (error.status === 401) {
                    ctx.status = 401;
                    ctx.body = "Protected resource, use Authorization header to get access";
                } else {
                    throw error;
                }
            });
        });

        Authenticator.init();

        // Applying JWT for routes.
        Server.current.use(Authenticator.getJwtMiddleware());

        // error handler
        Server.current.use(async (ctx, next) => {
            try {
                await next();
            } catch (error) {
                Logger.error({verbosity: 2})(error.message, error.stack).then();
                ctx.status = error.code || error.status || 500;
                const body: ResponseBody = {
                    success: false,
                    message: error.message,
                    response: error.response
                };
                if (config.appDebug) {
                    body.stack = error.stack;
                }
                ctx.body = body;
                // TODO: ctx.app.emit('error', err, ctx);
            }
        });


        // Getting controllers from directory in config.
        if (Server.current.config.controllersDir) {
            const found: any[] = importClassesFromDirectories(new MLogger(), [Server.current.config.controllersDir]);
            const controllers: any[] = [];
            for (const item of found) {
                if (item.prototype instanceof Controller)
                    controllers.push(item);
            }
            Logger.info({
                disableDB: true,
                verbosity: 3
            })("Server: found controllers: [", ...controllers.map(item => item.name), "]").then();
            Server.current.controllers = controllers.map(controller => new controller());

            for (const controller of Server.current.controllers)
                Server.current.router.use(controller.baseRoute, controller.routes(), controller.allowedMethods());
        } else {
            Logger.warn({
                disableDB: true,
                verbosity: 3
            })(`Server: Warning: "config.controllersDir" is not defined, controllers will not be loaded.`).then();
        }

        // Applying router routes.
        Server.current.use(Server.current.router.routes()).use(Server.current.router.allowedMethods());


        return Server.current;
    }

    /**
     * setupDbConnection - method, designed to setup connection with database.
     * @method
     * @author Danil Andreev
     */
    private async setupDbConnection(dbOptions: ConnectionOptions): Promise<void> {
        Logger.info({disableDB: true, verbosity: 2})("TypeORM: Setting up database connection...").then();
        this.DbConnection = await createConnection(dbOptions);
        await this.DbConnection.synchronize();
    }

    /**
     * setupRedisConnection - method, designed to setup connection with Redis.
     * @method
     * @param redisOptions
     * @author Danil Andreev
     */
    private setupRedisConnection(redisOptions: Redis.ClientOpts): Server {
        Logger.info({disableDB: true, verbosity: 2})("Redis: Setting up Redis connection...");
        this.RedisConnection = Redis.createClient(redisOptions);
        this.RedisConnection.on("error", (error: Error) => {
            throw error;
        });
        return this;
    }

    /**
     * setupRabbitMQConnection - method, designed to setup connection with RabbitMQ.
     * @method
     * @param rabbitMQOptions - options for RabbitMQ connection options.
     * @author Danil Andreev
     */
    private async setupRabbitMQConnection(rabbitMQOptions: Amqp.Options.Connect) {
        Logger.info({disableDB: true, verbosity: 2})("Redis: Setting up RabbitMQ connection...").then();
        this.RabbitMQConnection = await Amqp.connect(rabbitMQOptions, (error, connection) => {
            if (error) throw error;
        });

        const channel: Amqp.Channel = await this.RabbitMQConnection.createChannel();

        await channel.assertQueue(AMQP_CONNECTION_QUEUE);
        await channel.prefetch(1);
        await channel.consume(AMQP_CONNECTION_QUEUE, async (message: Amqp.Message) => {
            console.log(message, message.content.toString());
            channel.ack(message);
        });
    }

    /**
     * start - starts the wev server message handling cycle. If you want to run the server - call this method;
     * @method
     * @param port - Port on which server will start listening. If not set, will try to find it in config (config.port),
     * or map to default (3002)
     * @author Danil Andreev
     */
    public start(port?: string | number): void {
        const targetPort = port || this.config.port || 3002;
        Logger.info({disableDB: true, verbosity: 1})(`Server: server is listening on port ${targetPort}.`);
        this.server = this.listen(targetPort);
    }

    /**
     * close - closes server connection.
     * @method
     * @author Denis Afendikov
     */
    public close(): void {
        if (!this.server) {
            throw new ReferenceError("Cannot close server. Server was not started.");
        }
        Logger.info({disableDB: true, verbosity: 2})("Server closing connection.");
        this.DbConnection.close().then(() => {
            Logger.info({disableDB: true, verbosity: 2})("Closed DbConnection.");
        });
        this.RabbitMQConnection.close()
            .then(() => {
                Logger.info({disableDB: true, verbosity: 2})("Closed RabbitMQConnection.");
            })
            .catch(console.error);
        this.RedisConnection.quit(() => {
            Logger.info({disableDB: true, verbosity: 2})("Closed RedisConnection.");
        });

        this.server.close((error: Error | undefined) => {
            if (error) {
                Logger.error({
                    disableDB: true,
                    verbosity: 1
                })("Server: Error while closing.", error.message, error.stack);
            }
            Logger.info({disableDB: true, verbosity: 1})("Server closed connection");
        });
    }

    /**
     * useController - add new controller class
     * @method
     * @param controller - Controller that will be applied to server
     * @author Denis Afendikov
     */
    public useController(controller: Controller): void {
        //TODO: add controller name to decorator.
        Logger.info({disableDB: true, verbosity: 3})(`Connecting controller: ${controller.constructor.name}`);
        this.controllers.push(controller);
        this.router.use(controller.baseRoute, controller.routes(), controller.allowedMethods());

        // Applying router routes.
        this.use(this.router.routes()).use(this.router.allowedMethods());
    }
}

export default Server;

/**
 * MLogger - empty logger for Server importClassesFromDirectories() function.
 * @class
 * @author Danil Andreev
 */
class MLogger implements TypeOrmLogger {
    // TODO: add loggers
    // TODO: we need this for printSql!!!
    log(level: "log" | "info" | "warn", message: any, queryRunner?: QueryRunner): any {
    }

    logMigration(message: string, queryRunner?: QueryRunner): any {
    }

    logQuery(query: string, parameters?: any[], queryRunner?: QueryRunner): any {
    }

    logQueryError(error: string, query: string, parameters?: any[], queryRunner?: QueryRunner): any {
    }

    logQuerySlow(time: number, query: string, parameters?: any[], queryRunner?: QueryRunner): any {
    }

    logSchemaBuild(message: string, queryRunner?: QueryRunner): any {
    }
}
