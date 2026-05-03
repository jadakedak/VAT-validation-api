import nodecache from "node-cache";

const cache = new nodecache({
    stdTTL: 86400,
    checkperiod: 600,
    useClones: false,
    deleteOnExpire: true
});

export function get_cache(key){
    cache.get(key, (err, values) => {
        if(err){
            logger.error("error retrieving value from cache", { err, key });
            return null;
        }
        if(values === undefined){
            logger.info("cache miss", { key });
            return null;
        }
        logger.info("cache hit", { key });
        return values;
    });
}
export function set_cache(key, value){
    cache.set(key, value, (err) => {
        if(err){
            logger.error("error setting value in cache", { err, key });
        }
    });
}
export function delete_cache(key){
    cache.del(key, (err) => {
        if(err){
            logger.error("error deleting value from cache", { err, key });
        }
    });
}
export function clear_node_cache(){
    cache.flushAll((err) => {
        if(err){
            logger.error("error clearing cache", { err });
        }
    });
}
