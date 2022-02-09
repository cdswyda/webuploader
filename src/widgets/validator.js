/**
 * @fileOverview 各种验证，包括文件总大小是否超出、单文件是否超出和文件是否重复。
 */

define([
    '../base',
    '../uploader',
    '../file',
    './widget'
], function( Base, Uploader, WUFile ) {

    var $ = Base.$,
        validators = {},
        api;

    /**
     * @event error
     * @param {String} type 错误类型。
     * @description 当validate不通过时，会以派送错误事件的形式通知调用者。通过`upload.on('error', handler)`可以捕获到此类错误，目前有以下错误会在特定的情况下派送错来。
     *
     * * `Q_EXCEED_NUM_LIMIT` 在设置了`fileNumLimit`且尝试给`uploader`添加的文件数量超出这个值时派送。
     * * `Q_EXCEED_SIZE_LIMIT` 在设置了`Q_EXCEED_SIZE_LIMIT`且尝试给`uploader`添加的文件总大小超出这个值时派送。
     * * `Q_TYPE_DENIED` 当文件类型不满足时触发。。
     * @for  Uploader
     */

    // 暴露给外面的api
    api = {

        // 添加验证器
        addValidator: function( type, cb ) {
            validators[ type ] = cb;
        },

        // 移除验证器
        removeValidator: function( type ) {
            delete validators[ type ];
        }
    };

    // 在Uploader初始化的时候启动Validators的初始化
    Uploader.register({
        name: 'validator',

        init: function() {
            var me = this;
            Base.nextTick(function() {
                $.each( validators, function() {
                    this.call( me.owner );
                });
            });
        }
    });

    /**
     * @property {int} [fileNumLimit=undefined]
     * @namespace options
     * @for Uploader
     * @description 验证文件总数量, 超出则不允许加入队列。
     */
    api.addValidator( 'fileNumLimit', function() {
        var uploader = this,
            opts = uploader.options,
            count = 0,
            max = parseInt( opts.fileNumLimit, 10 ),
            flag = true;

        /**
         * at 20220-02-09 by chends
         * 不能直接返回 验证器应该始终添加 考虑如下情况，初始fileNumLimit为0 后续动态修改为1则验证会无效
         */
        // if ( !max ) {
        //     return;
        // }

        uploader.on( 'beforeFileQueued', function( file ) {
                // 增加beforeFileQueuedCheckfileNumLimit验证,主要为了再次加载时(已存在历史文件)验证数量是否超过设置项
            /** 
             * at 2022-02-08 by chends
             * 此处实现有问题，我们miniui的封装中已经存在的文件会进行单独计算，传递给上传控件的就是实际能上传的文件数目
             * 此处将当前文件和控件自己的数目传出，本质还是需要外部自行维护已有历时文件的数量，多此一举。
             * 上传控件专注于上传即可，取消这段逻辑。            
             if (!this.trigger('beforeFileQueuedCheckfileNumLimit', file,count)) {
                 return false;
             }
             * end 
            */
            max = parseInt( opts.fileNumLimit, 10 );
            if (isNaN(max) || max < 0) {
                return true;
            }
            if ( count >= max && flag ) {
                flag = false;
                this.trigger( 'error', 'Q_EXCEED_NUM_LIMIT', max, file );
                setTimeout(function() {
                    flag = true;
                }, 1 );
            }

            return count >= max ? false : true;
        });

        uploader.on( 'fileQueued', function() {
            count++;
        });

        uploader.on( 'fileDequeued', function() {
            count--;
        });

        uploader.on( 'reset', function() {
            count = 0;
        });
    });


    /**
     * @property {int} [fileSizeLimit=undefined]
     * @namespace options
     * @for Uploader
     * @description 验证文件总大小是否超出限制, 超出则不允许加入队列。
     */
    api.addValidator( 'fileSizeLimit', function() {
        var uploader = this,
            opts = uploader.options,
            count = 0,
            max = parseInt( opts.fileSizeLimit, 10 ),
            flag = true;

        if ( !max ) {
            return;
        }

        uploader.on( 'beforeFileQueued', function( file ) {
            var invalid = count + file.size > max;

            if ( invalid && flag ) {
                flag = false;
                this.trigger( 'error', 'Q_EXCEED_SIZE_LIMIT', max, file );
                setTimeout(function() {
                    flag = true;
                }, 1 );
            }

            return invalid ? false : true;
        });

        uploader.on( 'fileQueued', function( file ) {
            count += file.size;
        });

        uploader.on( 'fileDequeued', function( file ) {
            count -= file.size;
        });

        uploader.on( 'reset', function() {
            count = 0;
        });
    });

    /**
     * @property {int} [fileSingleSizeLimit=undefined]
     * @namespace options
     * @for Uploader
     * @description 验证单个文件大小是否超出限制, 超出则不允许加入队列。
     */
    api.addValidator( 'fileSingleSizeLimit', function() {
        var uploader = this,
            opts = uploader.options,
            max = opts.fileSingleSizeLimit;

        if ( !max ) {
            return;
        }

        uploader.on( 'beforeFileQueued', function( file ) {

            if ( file.size > max ) {
                file.setStatus( WUFile.Status.INVALID, 'exceed_size' );
                this.trigger( 'error', 'F_EXCEED_SIZE', max, file );
                return false;
            }

        });

    });

    /**
     * @property {Boolean} [duplicate=undefined]
     * @namespace options
     * @for Uploader
     * @description 去重， 根据文件名字、文件大小和最后修改时间来生成hash Key.
     */
    api.addValidator( 'duplicate', function() {
        var uploader = this,
            opts = uploader.options,
            mapping = {};

        if ( opts.duplicate ) {
            return;
        }

        function hashString( str ) {
            var hash = 0,
                i = 0,
                len = str.length,
                _char;

            for ( ; i < len; i++ ) {
                _char = str.charCodeAt( i );
                hash = _char + (hash << 6) + (hash << 16) - hash;
            }

            return hash;
        }

        uploader.on( 'beforeFileQueued', function( file ) {
            var hash = file.__hash || (file.__hash = hashString( file.name +
                    file.size + file.lastModifiedDate ));

            // 已经重复了
            if ( mapping[ hash ] ) {
                this.trigger( 'error', 'F_DUPLICATE', file );
                return false;
            }
        });

        uploader.on( 'fileQueued', function( file ) {
            var hash = file.__hash;

            hash && (mapping[ hash ] = true);
        });

        uploader.on( 'fileDequeued', function( file ) {
            var hash = file.__hash;

            hash && (delete mapping[ hash ]);
        });

        uploader.on( 'reset', function() {
            mapping = {};
        });
    });

    return api;
});
