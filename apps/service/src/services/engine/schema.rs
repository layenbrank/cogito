use std::fmt;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum TSchema {
    LT,
    MT,
    SC,
    CT,
    UT,
    PN,
    MB,
    RI,
    NWB,
    OS,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmptySchema {
    id: String,
    q: String,
    u: String,
    t: TSchema,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ISchema {
    ig: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SuggestionR {
    s: Vec<EmptySchema>,
    i: ISchema,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct QueryP {
    pt: String,
    qry: String,
    cp: u64,
    csr: String,
    pths: String,
    cvid: String,
}

impl QueryP {
    pub fn new(pt: String, qry: String, cp: u64, csr: String, pths: String, cvid: String) -> Self {
        QueryP {
            pt,
            qry,
            cp,
            csr,
            pths,
            cvid,
        }
    }
}

impl fmt::Display for SuggestionR {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "suggestion s: {:?}, i: {:?}", self.s, self.i,)
    }
}

impl fmt::Display for QueryP {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "QueryP:\npt: {}\nqry: {}\ncp: {}\ncsr: {}\npths: {}\ncvid: {}",
            self.pt, self.qry, self.cp, self.csr, self.pths, self.cvid
        )
    }
}
