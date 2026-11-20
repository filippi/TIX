/* From repository root: cc -std=c99 -Wall -Wextra -Werror -pedantic
 * -I. tests/test_tix.c -o /tmp/test_tix && /tmp/test_tix */
#include "tix.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <inttypes.h>

static FILE *open_vectors(const char *name) {
    FILE *f = fopen(name, "r");
    assert(f != NULL);
    return f;
}
int main(void) {
    FILE *f;
    char line[8192],name[128],h[64],b[64],kind[64],value[128];
    unsigned bits,l;
    int64_t q,a,z;
    size_t checks=0;
    f=open_vectors("tests/vectors.tsv");
    while(fgets(line,sizeof line,f)) {
        uint64_t code,parsed,par,kids[2];
        char hex[TIX_HEX_DIGITS+1],base64[12];
        tix_interval d,left,right;
        int yes;
        if(line[0]=='#')continue;
        assert(sscanf(line,"%127s %u %" SCNd64 " %u %63s %63s %" SCNd64 " %" SCNd64,
                      name,&bits,&q,&l,h,b,&a,&z)==8);
        if(bits!=TIX_BITS)continue;
        assert(tix_encode(q,l,&code));
        assert(tix_to_hex(code,hex) && strcmp(hex,h)==0);
        assert(tix_to_base64(code,base64) && strcmp(base64,b)==0);
        assert(tix_from_hex(h,&parsed) && parsed==code);
        assert(tix_from_base64(b,&parsed) && parsed==code);
        assert(tix_decode(code,&d) && d.level==l && d.start_ticks==a && d.end_ticks==z);
        assert(tix_parent(code,l,&par) && par==code);
        if(l) {
            assert(tix_parent(code,l-1,&par) && tix_children(par,kids));
            assert(kids[0]==code || kids[1]==code);
        }
        if(l<TIX_PREFIX_BITS) {
            assert(tix_children(code,kids));
            assert(tix_parent(kids[0],l,&par) && par==code);
            assert(tix_parent(kids[1],l,&par) && par==code);
            assert(tix_contains(code,kids[0],&yes) && yes);
            assert(tix_overlaps(kids[0],kids[1],&yes) && !yes);
            assert(tix_decode(kids[0],&left) && tix_decode(kids[1],&right));
            assert(left.end_ticks==right.start_ticks);
        } else assert(!tix_children(code,kids));
        assert(!tix_parent(code,l+1,&par));
        ++checks;
    }
    fclose(f);
    f=open_vectors("tests/invalid.tsv");
    while(fgets(line,sizeof line,f)) {
        uint64_t out=123;
        int ok=1;
        if(line[0]=='#')continue;
        assert(sscanf(line,"%u %63s %127s",&bits,kind,value)==3);
        if(bits!=TIX_BITS)continue;
        if(strcmp(kind,"hex")==0)ok=tix_from_hex(value,&out);
        else if(strcmp(kind,"base64")==0)ok=tix_from_base64(value,&out);
        else if(strcmp(kind,"code")==0)ok=tix_valid(strtoull(value,NULL,10));
        else if(strcmp(kind,"time")==0)ok=tix_encode(strtoll(value,NULL,10),0,&out);
        else if(strcmp(kind,"level")==0)ok=tix_encode(0,(unsigned)strtol(value,NULL,10),&out);
        assert(!ok && out==123);++checks;
    }
    fclose(f);
    f=open_vectors("tests/operations.tsv");
    while(fgets(line,sizeof line,f)) {
        uint64_t ca,cb;
        int expected,out;
        if(line[0]=='#')continue;
        assert(sscanf(line,"%u %63s %63s %63s %d",&bits,kind,h,b,&expected)==5);
        if(bits!=TIX_BITS)continue;
        assert(tix_from_hex(h,&ca) && tix_from_hex(b,&cb));
        if(strcmp(kind,"contains")==0)assert(tix_contains(ca,cb,&out));
        else assert(tix_overlaps(ca,cb,&out));
        assert(out==expected);++checks;
    }
    fclose(f);
    f=open_vectors("tests/ranges.tsv");
    while(fgets(line,sizeof line,f)) {
        uint64_t cells[TIX_COVER_CAPACITY],guard=123;
        size_t count=999,required=999,i=0;
        char expected[4096],*token;
        if(line[0]=='#')continue;
        assert(sscanf(line,"%u %" SCNd64 " %" SCNd64 " %u %4095s",&bits,&a,&z,&l,expected)==5);
        if(bits!=TIX_BITS)continue;
        assert(tix_cover(a,z,l,cells,TIX_COVER_CAPACITY,&count));
        assert(tix_cover(a,z,l,NULL,0,&required)==(count==0));
        assert(required==count);
        if(count) {
            assert(!tix_cover(a,z,l,&guard,0,&required) && guard==123);
            token=strtok(expected,",");
            while(token) {
                uint64_t code;
                assert(i<count && tix_from_hex(token,&code) && cells[i++]==code);
                token=strtok(NULL,",");
            }
            assert(i==count);
        } else assert(strcmp(expected,"-")==0);
        ++checks;
    }
    fclose(f);
    {
        uint64_t code=123,cells[TIX_COVER_CAPACITY];
        tix_interval d;
        size_t count=999;
        int result=123;
        assert(!tix_encode(0,0,NULL));assert(!tix_decode(0,NULL));
        assert(!tix_parent(0,0,NULL));assert(!tix_children(0,NULL));
        assert(!tix_contains(0,0,NULL));assert(!tix_overlaps(0,0,NULL));
        assert(!tix_to_hex(0,NULL));assert(!tix_to_base64(0,NULL));
        assert(!tix_from_hex(NULL,&code));assert(!tix_from_base64(NULL,&code));
        assert(!tix_decode(1,&d));
        assert(!tix_contains(0,1,&result) && result==123);
        assert(!tix_overlaps(1,0,&result) && result==123);
        assert(!tix_cover(1,0,TIX_PREFIX_BITS,cells,TIX_COVER_CAPACITY,&count) && count==999);
        assert(!tix_cover(-TIX_EPOCH_TICKS-1,0,TIX_PREFIX_BITS,cells,TIX_COVER_CAPACITY,&count));
        assert(!tix_cover(0,TIX_EPOCH_TICKS+1,TIX_PREFIX_BITS,cells,TIX_COVER_CAPACITY,&count));
        assert(!tix_cover(0,1,TIX_PREFIX_BITS+1,cells,TIX_COVER_CAPACITY,&count));
    }
    assert(checks>0);
    printf("C TIX%d: %zu shared vector/operation/range cases passed\n",TIX_BITS,checks);
    return 0;
}
