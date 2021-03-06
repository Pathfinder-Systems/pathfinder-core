/*
 * Copyright (c) 2020. This code created and belongs to Atlas render manager project.
 * Owner and project architect: Danil Andreev | danssg08@gmail.com |  https://github.com/DanilAndreev
 * Project: atlas-core
 * File last modified: 11/12/20, 5:25 PM
 * All rights reserved.
 */

import RenderJob from "./entities/typeorm/RenderJob";
import User from "./entities/typeorm/User";
import Role from "./entities/typeorm/Role";
import Organization from "./entities/typeorm/Organization";
import OrganizationLog from "./entities/typeorm/OrganizationLog";
import RenderTask from "./entities/typeorm/RenderTask";
import RenderTaskAttempt from "./entities/typeorm/RenderTaskAttempt";
import RenderTaskAttemptLog from "./entities/typeorm/RenderTaskAttemptLog";
import RenderJobLog from "./entities/typeorm/RenderJobLog";
import Plugin from "./entities/typeorm/Plugin";
import GlobalPlugin from "./entities/typeorm/GlobalPlugin";
import Slave from "./entities/typeorm/Slave";
import UserToken from "./entities/typeorm/UserToken";
import SystemLog from "./entities/typeorm/SystemLog";
import Temp from "./entities/typeorm/Temp";
import {RenderTaskSubscriber} from "./subscribers/RenderTaskSubscriber";
import UserPrivateData from "./entities/typeorm/UserPrivateData";
import {RenderJobSubscriber} from "./subscribers/RenderJobSubscriber";
import RenderTaskAttemptLogSubscriber from "./subscribers/RenderTaskAttemptLogSubscriber";
import RenderTaskAttemptSubscriber from "./subscribers/RenderTaskAttemptSubscriber";
import Server from "./core/Server";


const port: number = +process.env.PORT || 3002;

export const config: Server.Config = {
    appDebug: true,
    port: port,
    db: {
        type: "postgres",
        // logging: true,
        entities: [
            RenderJob, User, UserToken, UserPrivateData, Role, Organization, OrganizationLog,
            RenderTask, RenderTaskAttempt, RenderTaskAttemptLog, RenderJobLog,
            Plugin, GlobalPlugin, Slave, SystemLog, Temp
        ],
        subscribers: [
            RenderTaskSubscriber, RenderJobSubscriber, RenderTaskAttemptLogSubscriber, RenderTaskAttemptSubscriber
        ]
    },
    redis: {
    },
    rabbit: {
    }
};