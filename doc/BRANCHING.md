### New branching strategy

    .------70-------. .----- 71 ------. .----- 72 ------. .----- 73 ------. .----- 74 ------. .----- 75 ------. .----- 76 -
    WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT
    ================o=================o=================o=================o=================o=================o============
                    |                 |                 |                 |                 |                 |            
    *-----*         |                 o-72--------------^-------------*-----*-----*         |                 o-76---------
                    |                 |                 |                 |                 |                 |            
    69----------*-----*-----*         |                 o-73--------------^-------------*-----*-----*         |            
                    |                 |                                   |                 |                 |            
    70--------------^-------------*-----*-----*                           o-74--------------^-------------*-----*-----*    
                    |                 |                                                     |                 |            
                    o-71--------------^-------------*-----*-----*                           o-75--------------^------------
    CODE IN PRODUCTION
    - 68 ------>|<----- 69 ------>|<----- 70 ------>|<----- 71 ------>|<----- 72 ------>|<----- 73 ------>|<----- 74 ----->

### What versions for any service look like as an iteration goes through development, RC, MR and HF stages

    Event description                     : Branch name            : Branches (#tags)           : Artifact Build               : POM Version Change
    ------------------------------------- : --------------------   : -------------------------- : --------------------         : -------------------
    Starting point                        : develop                : o                          :                              : 69.0.0.59-SNAPSHOT
                                          :                        : |                          :                              :
    Sprint 70 begins                      : develop/70.0.0         : |-->o (#dev)               : DO-NOT-BUILD                 : 70.0.0.1-SNAPSHOT
                                          :                        : |   |                      :                              :
    Start feature work on VCTRS-1000      : feature/VCTRS-1000-... : |   |-->o                  : 70.0.0.1-VCTRS-1000-SNAPSHOT : 70.0.0.1-VCTRS-1000-SNAPSHOT
                                          :                        : |   |   |                  :                              :
    Push changes                          :                        : |   |   o                  : 70.0.0.1-VCTRS-1000-SNAPSHOT :
                                          :                        : |   |   |                  :                              :
    Start feature work on VCTRS-2000      : feature/VCTRS-2000-... : |   |------>o              : 70.0.0.1-VCTRS-2000-SNAPSHOT : 70.0.0.1-VCTRS-2000-SNAPSHOT
                                          :                        : |   |   |   |              :                              :
    Push changes                          :                        : |   |   |   o              : 70.0.0.1-VCTRS-2000-SNAPSHOT :
                                          :                        : |   |   |   |              :                              :
    Merge changes for VCTRS-1000          :                        : |   o<--'   |              : 70.0.0.1                     : 70.0.0.2-SNAPSHOT
                                          :                        : |   |       |              :                              :
    Push changes                          :                        : |   |       o              : 70.0.0.1-VCTRS-2000-SNAPSHOT :
                                          :                        : |   |       |              :                              :
    Merge changes for VCTRS-2000          :                        : |   o<------'              : 70.0.0.2                     : 70.0.0.3-SNAPSHOT
                                          :                        : |   |                      :                              :
    Sprint 70 ends                        :                        : o<--|                      : DO-NOT-BUILD                 :
                                          :                        : |   |                      :                              :
    Move #rc tag to this branch           :                        : |   o (#rc)                :                              :
                                          :                        : |   |                      :                              :
    Bugfix VCTRS-3000 for RC              : bugfix/VCTRS-3000      : |   |-->o                  :                              :
                                          :                        : |   |   |                  :                              :
    Merge changes for VCTRS-3000          :                        : |   o<--'                  : 70.0.0.3 *GA                 : 70.0.0.4-SNAPSHOT
                                          :                        : |   |                      :                              :
    GA release                            :                        : |  *o (#prod)              :                              :
                                          :                        : |   |                      :                              :
    Start work for an MR                  : develop/70.1.0         : |   |-->o (#mr)            :                              : 70.1.0.1-SNAPSHOT
                                          :                        : |   |   |                  :                              :
    Commit changes for VCTRS-4000         :                        : |   |   o                  : 70.1.0.1                     : 70.1.0.2-SNAPSHOT
                                          :                        : |   |   |                  :                              :
    HF branch created                     : develop/70.0.1         : |   |------>o (#hf)        :                              : 70.0.1.1-SNAPSHOT
                                          :                        : |   |   |   |              :                              :
    Commit changes for HF (VCTRS-5000)    :                        : |   |   |   o              : 70.0.1.1 *HF1                : 70.0.1.2-SNAPSHOT
                                          :                        : |   |   |   |              :                              :
    HF1 release                           :                        : |  *o<------'              : DO-NOT-BUILD                 :
                                          :                        : |   |   |                  :                              :
    Commit more MR changes                :                        : |   |   o                  : 70.1.0.2 *MR1                : 70.1.0.3-SNAPSHOT
                                          :                        : |   |   |                  :                              :
    HF branch created                     : develop/70.0.2         : |   |------>o (#hf)        :                              : 70.0.2.1-SNAPSHOT
                                          :                        : |   |   |   |              :                              :
    Commit changes for HF (VCTRS-6000)    :                        : |   |   |   o              : 70.0.2.1 *HF2                : 70.0.2.2-SNAPSHOT
                                          :                        : |   |   |   |              :                              :
    HF2 release                           :                        : |  *o<------'              : DO-NOT-BUILD                 :
                                          :                        : |   |   |                  :                              :
    MR1 release                           :                        : |  *o<--'                  : DO-NOT-BUILD                 :
                                          :                        : |   |                      :                              :
    HF branch created                     : develop/70.1.1         : |   |------>o (#hf)        :                              : 70.1.1.1-SNAPSHOT
                                          :                        : |   |       |              :                              :
    Commit changes for HF (VCTRS-5000)    :                        : |   |       o              : 70.1.1.1 *MR1HF1             : 70.1.1.2-SNAPSHOT
                                          :                        : |   |       |              :                              :
    MR1HF1 release                        :                        : |  *o<------'              :                              :
                                          :                        : |   |                      :                              :

Notes on the above timeline:

* Merge changes are not reflected
* This is just the Sprint 70 branch story
* Bugfixes (for RC) do not deploy to separate environments
* Not showing MR and HF changes reflected in other branches
* Dealing with dependency ranges not shown

### Things to consider

* Epic environment
* Feature which slips

## Saved for later

    Switch to MR line                     : |  <o>                    : x.x.x.x                      : 70.1.0.0                     :
                                          : |   |                     :                              :                              :
    Start MR work on VCTRS-4000           : |   |-->o                 : 70.1.0.1-VCTRS-4000          : x.x.x.x                      : feature/VCTRS-4000
                                          : |   |   |                 :                              :                              :
    Start MR work on VCTRS-5000           : |   |------>o             : 70.1.0.1-VCTRS-5000          : x.x.x.x                      : bugfix/VCTRS-5000
                                          : |   |   |   |             :                              :                              :
    Merge changes for VCTRS-4000          : |   o<--'   |             : x.x.x.x                      : 70.1.0.2                     :
                                          : |   |       |             :                              :                              :
    HF branch created (from #prod)        : |  ------------>o (#hf)   : 70.0.1.1                     : x.x.x.x                      : hotfix/sprint-70.0.1
                                          : |   |       |   |         :                              :                              :
    Start HF work for VCTRS-6000          : |   |       |   |-->o     : 70.0.1.1-VCTRS-6000          : x.x.x.x                      : hoftix/VCTRS-6000
                                          : |   |       |   |   |     :                              :                              :
    Merge changes for VCTRS-6000          : |   |       |   o<--'     : x.x.x.x                      : 70.0.1.2                     :
                                          : |   |       |   |         :                              :                              :
    Release to production                 : |   |       |  *o (#prod) : x.x.x.x                      : 70.0.2.1                     :
                                          : |   |       |             :                              :                              :
    Merge changes for VCTRS-5000          : |   o<------'             : x.x.x.x                      : 70.1.0.3                     :
                                          : |   |                     :                              :                              :
    Release to production                 : |  *o (#prod)             : x.x.x.x                      : 70.2.0.1                     :
                                          : |                         :                              :                              :
                                          : |                         :                              :

### More exahustive timeline

    .----- 68 ------. .----- 69 ------. .----- 70 ------. .----- 71 ------. .----- 72 ------. .----- 73 ------. .----- 74 ------. .----- 75 ------. .----- 76 ------.
    |               | |               | |               | |               | |               | |               | |               | |               | |               |
    WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT

    o===============o=================o=================o=================o=================o=================o=================o=================o=================o
    |               |                 |                 |                 |                 |                 |                 |                 |                 |
    o-68------------^-------------*-----*-----*         |                 o-72--------------^-------------*-----*-----*         |                 o-76--------------|
                    |                 |                 |                 |                 |                 |                 |                 |                 |
                    o-69--------------^-------------*-----*-----*         |                 o-73--------------^-------------*-----*-----*         |                 o
                                      |                 |                 |                                   |                 |                 |                  
                                      o-70--------------^-------------*-----*-----*                           o-74--------------^-------------*-----*-----*          
                                                        |                 |                                                     |                 |
                                                        o-71--------------^-------------*-----*-----*                           o-75--------------^-------------*----

    WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT WHFMT
    |               | |               | |               | |               | |               | |               | |               | |               | |               |
    '----- 68 ------' '----- 69 ------' '----- 70 ------' '----- 71 ------' '----- 72 ------' '----- 73 ------' '----- 74 ------' '----- 75 ------' '----- 76 ------'


### Another way of looking at it

             o-68------------.-------------*-----*-----*
             |               |
             |               |                 o-70--------------.-------------*-----*-----*
             |               |                 |                 |
    =========o===============o=================o=================o=================o=========================================
             |               |                 |                 |                 |
             |               |                 |                 o-71--------------'-------------*-----*-----*
             |               |                 |
             |               o-69--------------'-------------*-----*-----*

### Other ways of show what's in produciton (Because I can't delete ascii art alternatives)

    -----------------------------------------------------------------------------------------------------------------------


    '     '           '     '           '     '           '     '           '     '           '     '           '     '    

    .-----.-----*-----.-----.-----*-----.-----.-----*-----.-----.-----*-----.-----.-----*-----.-----.-----*-----.-----.----
                69                70                71                72                73                74             


    .-----.-----*-69--.-----.-----*-70--.-----.-----*-71--.-----.-----*-72--.-----.-----*-73--.-----.-----*-74--.-----.----


    '     '    ||     '     '    ||     '     '    ||     '     '    ||     '     '    ||     '     '    ||     '     '    
    - 68 ------''------ 69 ------''------ 70 ------''------ 71 ------''------ 72 ------''------ 73 ------''------ 74 ------

